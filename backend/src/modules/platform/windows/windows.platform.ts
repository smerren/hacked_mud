import { err, errAsync, ok, okAsync, type Result } from "neverthrow";
import { log } from "@backend/plugins/logger/logger";
import type { NullPointerError } from "@backend/utils/neverthrow";
import type { MemoryReaderError } from "../../memoryReader/memoryReader.models";
import type { ModuleInfo } from "../../procParser/procParser.types";
import type { KeyName } from "../../virtualKeyboard/virtualKeyboard.model";
import type {
  HackmudValidPid,
  KeyboardTarget,
  MemorySource,
  Platform,
  WinApiError,
} from "../platform.types";
import { findPeExport } from "./PeParser";
import {
  INVALID_HANDLE_VALUE,
  LIST_MODULES_ALL,
  MAPVK_VK_TO_VSC,
  MBI,
  MBI_SIZE,
  MEM_COMMIT,
  MEM_IMAGE,
  MEM_PRIVATE,
  PAGE_GUARD,
  PAGE_NOACCESS,
  PAGE_READABLE,
  PE32W,
  PE32W_SIZE,
  PROCESS_QUERY_INFORMATION,
  PROCESS_VM_READ,
  TH32CS_SNAPPROCESS,
  WM_CHAR,
  WM_KEYDOWN,
  WM_KEYUP,
  readWideString,
  u64,
  win32,
} from "./win32.ffi";

const HACKMUD_EXE = "hackmud_win.exe";
const MONO_MODULE_NAME = "mono-2.0-bdwgc.dll";
const UNITY_WINDOW_CLASS = "UnityWndClass";

const VIRTUAL_KEYS: Record<KeyName, number> = {
  Return: 0x0d,
  Escape: 0x1b,
};

function winApiError(fn: string): WinApiError {
  return { type: "WINAPI_ERROR", fn, code: win32().kernel32.GetLastError() };
}

function openProcess(pid: number): Result<bigint, WinApiError> {
  const h = u64(win32().kernel32.OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, 0, pid));
  if (h == 0n) return err(winApiError("OpenProcess"));
  return ok(h);
}

function withProcess<T, E>(
  pid: number,
  fn: (handle: bigint) => Result<T, E>
): Result<T, E | WinApiError> {
  const h = openProcess(pid);
  if (h.isErr()) return err(h.error);
  try {
    return fn(h.value);
  } finally {
    win32().kernel32.CloseHandle(h.value);
  }
}

export function listProcesses(): Result<{ pid: number; exe: string }[], WinApiError> {
  const { kernel32 } = win32();
  const snapshot = u64(kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
  if (snapshot == INVALID_HANDLE_VALUE) return err(winApiError("CreateToolhelp32Snapshot"));

  try {
    const entry = Buffer.alloc(PE32W_SIZE);
    entry.writeUInt32LE(PE32W_SIZE, PE32W.dwSize);

    const res: { pid: number; exe: string }[] = [];
    let has = kernel32.Process32FirstW(snapshot, entry);
    while (has) {
      res.push({
        pid: entry.readUInt32LE(PE32W.th32ProcessID),
        exe: readWideString(entry, PE32W.szExeFile, PE32W.szExeFileChars),
      });
      has = kernel32.Process32NextW(snapshot, entry);
    }
    return ok(res);
  } finally {
    kernel32.CloseHandle(snapshot);
  }
}

function listModules(handle: bigint): Result<{ base: bigint; name: string }[], WinApiError> {
  const { kernel32 } = win32();
  let capacity = 1024;
  let modules: Buffer;
  const needed = Buffer.alloc(4);

  while (true) {
    modules = Buffer.alloc(capacity * 8);
    const okCall = kernel32.K32EnumProcessModulesEx(
      handle,
      modules,
      modules.length,
      needed,
      LIST_MODULES_ALL
    );
    if (!okCall) return err(winApiError("K32EnumProcessModulesEx"));
    if (needed.readUInt32LE(0) <= modules.length) break;
    capacity = needed.readUInt32LE(0) / 8;
  }

  const count = needed.readUInt32LE(0) / 8;
  const nameBuf = Buffer.alloc(520);
  const res: { base: bigint; name: string }[] = [];
  for (let i = 0; i < count; i++) {
    const base = modules.readBigUInt64LE(i * 8);
    const len = kernel32.K32GetModuleBaseNameW(handle, base, nameBuf, nameBuf.length / 2);
    res.push({ base, name: len ? nameBuf.toString("utf16le", 0, len * 2) : "" });
  }
  return ok(res);
}

function findMonoModule(handle: bigint) {
  return listModules(handle).map(mods => mods.find(m => m.name.toLowerCase() == MONO_MODULE_NAME));
}

/** Finds the top-level game window of a process. Prefers unity's main window class */
function findWindow(pid: number): number | undefined {
  const { user32 } = win32();
  const pidBuf = Buffer.alloc(4);
  const classBuf = Buffer.alloc(512);

  let fallback: bigint | undefined;
  let hwnd = 0n;
  while (true) {
    hwnd = u64(user32.FindWindowExW(0n, hwnd, null, null));
    if (hwnd == 0n) break;

    user32.GetWindowThreadProcessId(hwnd, pidBuf);
    if (pidBuf.readUInt32LE(0) != pid) continue;
    if (!user32.IsWindowVisible(hwnd)) continue;

    const len = user32.GetClassNameW(hwnd, classBuf, classBuf.length / 2);
    const className = classBuf.toString("utf16le", 0, len * 2);
    // sandboxie prefixes classes of sandboxed windows, e.g. "Sandbox:BoxName::UnityWndClass"
    if (className == UNITY_WINDOW_CLASS || className.endsWith(":" + UNITY_WINDOW_CLASS))
      return Number(hwnd);
    fallback ??= hwnd;
  }
  return fallback === undefined ? undefined : Number(fallback);
}

function getRegions(handle: bigint): ModuleInfo[] {
  const { kernel32 } = win32();
  const mbi = Buffer.alloc(MBI_SIZE);
  const regions: ModuleInfo[] = [];

  let addr = 0n;
  while (u64(kernel32.VirtualQueryEx(handle, addr, mbi, MBI_SIZE)) != 0n) {
    const start = mbi.readBigUInt64LE(MBI.BaseAddress);
    const size = mbi.readBigUInt64LE(MBI.RegionSize);
    if (size == 0n) break;

    const state = mbi.readUInt32LE(MBI.State);
    const protect = mbi.readUInt32LE(MBI.Protect);
    const type = mbi.readUInt32LE(MBI.Type);

    const readable =
      state == MEM_COMMIT &&
      (protect & PAGE_READABLE) != 0 &&
      (protect & (PAGE_GUARD | PAGE_NOACCESS)) == 0;

    if (readable) {
      // empty path == anonymous memory, the same convention as /proc/pid/maps
      let regionPath = "";
      if (type == MEM_IMAGE) regionPath = "[image]";
      else if (type != MEM_PRIVATE) regionPath = "[mapped]";
      regions.push({ start, end: start + size, size, path: regionPath });
    }

    addr = start + size;
  }
  return regions;
}

class WinProcessMemSource implements MemorySource {
  private bytesRead = Buffer.alloc(8);

  constructor(private handle: bigint) {}

  async read(buffer: Buffer, size: number, address: bigint): Promise<number> {
    this.bytesRead.writeBigUInt64LE(0n);
    const success = win32().kernel32.ReadProcessMemory(
      this.handle,
      address,
      buffer,
      size,
      this.bytesRead
    );
    // on partial reads ReadProcessMemory fails but still reports how much it copied
    if (!success && this.bytesRead.readBigUInt64LE(0) == 0n) {
      const e = winApiError("ReadProcessMemory");
      throw new Error(`ReadProcessMemory failed at 0x${address.toString(16)} (code ${e.code})`);
    }
    return Number(this.bytesRead.readBigUInt64LE(0));
  }

  async close(): Promise<void> {
    win32().kernel32.CloseHandle(this.handle);
  }
}

function postMessage(hwnd: number, msg: number, wParam: bigint, lParam: bigint) {
  if (!win32().user32.PostMessageW(BigInt(hwnd), msg, wParam, lParam)) {
    const e = winApiError("PostMessageW");
    throw new Error(`PostMessageW failed for window ${hwnd} (code ${e.code})`);
  }
}

export const windowsPlatform: Platform = {
  name: "windows",

  findClients() {
    const procs = listProcesses();
    if (procs.isErr()) return errAsync(procs.error);

    const clients: HackmudValidPid[] = [];
    for (const proc of procs.value) {
      if (proc.exe.toLowerCase() != HACKMUD_EXE) continue;

      const mono = withProcess(proc.pid, findMonoModule);
      if (mono.isErr()) {
        log.warn({ pid: proc.pid, error: mono.error });
        continue;
      }
      if (!mono.value) {
        log.trace(proc.pid + " has no mono module (yet?)");
        continue;
      }

      const windowId = findWindow(proc.pid);
      if (windowId === undefined) {
        log.warn(proc.pid + " has no window");
        continue;
      }

      clients.push({ pid: proc.pid, windowId, display: 0 });
    }
    return okAsync(clients);
  },

  openMemory(pid) {
    const h = openProcess(pid);
    if (h.isErr()) {
      return errAsync({
        type: "MEMORY_READER_ERROR",
        cause: new Error(`OpenProcess(${pid}) failed with code ${h.error.code}`),
      } satisfies MemoryReaderError);
    }
    return okAsync(new WinProcessMemSource(h.value) as MemorySource);
  },

  getMemoryRegions(pid) {
    const res = withProcess(pid, h => ok(getRegions(h)));
    return res.isOk() ? okAsync(res.value) : errAsync(res.error);
  },

  findMonoRootDomain(pid, _regions, mr) {
    const mono = withProcess(pid, findMonoModule);
    if (mono.isErr()) return errAsync(mono.error);
    if (!mono.value)
      return errAsync({ type: "NULL_POINTER_ERROR", var: "monoModule" } satisfies NullPointerError);

    const base = mono.value.base;
    return findPeExport(mr, base, "mono_get_root_domain").andThen(rva => {
      if (rva === undefined)
        return err({ type: "NULL_POINTER_ERROR", var: "monoDomain" } satisfies NullPointerError);
      return ok({ monoModuleStart: base, rootDomainFn: rva });
    });
  },

  async sendText(target: KeyboardTarget, text: string) {
    for (let i = 0; i < text.length; i++) {
      postMessage(target.windowId, WM_CHAR, BigInt(text.charCodeAt(i)), 1n);
    }
  },

  async sendKey(target: KeyboardTarget, key: KeyName) {
    const vk = VIRTUAL_KEYS[key];
    const scan = BigInt(win32().user32.MapVirtualKeyW(vk, MAPVK_VK_TO_VSC));
    const down = 1n | (scan << 16n);
    const up = down | (1n << 30n) | (1n << 31n);
    postMessage(target.windowId, WM_KEYDOWN, BigInt(vk), down);
    postMessage(target.windowId, WM_KEYUP, BigInt(vk), up);
  },
};
