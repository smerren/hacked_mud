import { dlopen, FFIType } from "bun:ffi";

// HANDLE / HWND / HMODULE / addresses are all passed as u64 so we never lose precision.
// Buffers (Buffer / TypedArray) are passed directly to `ptr` arguments.

export const PROCESS_VM_READ = 0x0010;
export const PROCESS_QUERY_INFORMATION = 0x0400;

export const TH32CS_SNAPPROCESS = 0x2;
export const INVALID_HANDLE_VALUE = 0xffffffffffffffffn;

export const LIST_MODULES_ALL = 0x3;

export const MEM_COMMIT = 0x1000;
export const MEM_PRIVATE = 0x20000;
export const MEM_IMAGE = 0x1000000;
export const MEM_MAPPED = 0x40000;

export const PAGE_NOACCESS = 0x01;
export const PAGE_GUARD = 0x100;
export const PAGE_READABLE = 0x02 | 0x04 | 0x08 | 0x20 | 0x40 | 0x80; // R, RW, WC, XR, XRW, XWC

export const WM_KEYDOWN = 0x0100;
export const WM_KEYUP = 0x0101;
export const WM_CHAR = 0x0102;
export const MAPVK_VK_TO_VSC = 0;

// sizeof(MEMORY_BASIC_INFORMATION) on x64
export const MBI_SIZE = 48;
export const MBI = {
  BaseAddress: 0,
  AllocationBase: 8,
  RegionSize: 24,
  State: 32,
  Protect: 36,
  Type: 40,
} as const;

// sizeof(PROCESSENTRY32W) on x64
export const PE32W_SIZE = 568;
export const PE32W = {
  dwSize: 0,
  th32ProcessID: 8,
  szExeFile: 44,
  szExeFileChars: 260,
} as const;

function load() {
  const kernel32 = dlopen("kernel32.dll", {
    OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    GetLastError: { args: [], returns: FFIType.u32 },
    ReadProcessMemory: {
      args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr],
      returns: FFIType.i32,
    },
    VirtualQueryEx: {
      args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64],
      returns: FFIType.u64,
    },
    CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.u64 },
    Process32FirstW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    Process32NextW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    K32EnumProcessModulesEx: {
      args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32,
    },
    K32GetModuleBaseNameW: {
      args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u32],
      returns: FFIType.u32,
    },
  });

  const user32 = dlopen("user32.dll", {
    FindWindowExW: {
      args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.ptr],
      returns: FFIType.u64,
    },
    GetWindowThreadProcessId: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.u32 },
    GetClassNameW: { args: [FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    IsWindowVisible: { args: [FFIType.u64], returns: FFIType.i32 },
    PostMessageW: {
      args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.i64],
      returns: FFIType.i32,
    },
    MapVirtualKeyW: { args: [FFIType.u32, FFIType.u32], returns: FFIType.u32 },
  });

  return { kernel32: kernel32.symbols, user32: user32.symbols };
}

let libs: ReturnType<typeof load> | undefined;

/** Lazily loads the win32 libraries so that importing this file on linux is harmless */
export function win32() {
  return (libs ??= load());
}

/** bun returns u64 as either number or bigint depending on version, normalize it */
export function u64(v: number | bigint): bigint {
  return BigInt(v);
}

export function wideString(s: string): Buffer {
  return Buffer.from(s + "\0", "utf16le");
}

export function readWideString(buffer: Buffer, offset = 0, maxChars = buffer.length / 2): string {
  let end = offset;
  const limit = offset + maxChars * 2;
  while (end < limit && buffer.readUInt16LE(end) !== 0) end += 2;
  return buffer.toString("utf16le", offset, end);
}
