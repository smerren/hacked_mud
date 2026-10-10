import type { ResultAsync } from "neverthrow";
import type { ExecError, NullPointerError, UnsupportedError } from "@backend/utils/neverthrow";
import type { MemoryReaderError } from "../memoryReader/memoryReader.models";
import type { MemoryReader } from "../memoryReader/memoryReader.service";
import type { ModuleInfo, ProcNotFoundError } from "../procParser/procParser.types";
import type { KeyName } from "../virtualKeyboard/virtualKeyboard.model";

/**
 * A running hackmud instance that we can read and send keys to.
 * - linux: windowId is the X11 window id, display is the X display number (DISPLAY=:N)
 * - windows: windowId is the HWND, display is unused (always 0)
 */
export type HackmudValidPid = { pid: number; windowId: number; display: number };

export type KeyboardTarget = Pick<HackmudValidPid, "windowId" | "display">;

export type WinApiError = {
  type: "WINAPI_ERROR";
  fn: string;
  code: number;
};

export type PlatformError =
  | ExecError
  | ProcNotFoundError
  | NullPointerError
  | UnsupportedError
  | MemoryReaderError
  | WinApiError;

/** Raw access to another process' memory. MemoryReader builds typed reads on top of this */
export interface MemorySource {
  /** Reads up to `size` bytes at `address` into `buffer`. Resolves with the number of bytes read */
  read(buffer: Buffer, size: number, address: bigint): Promise<number>;
  close(): Promise<void>;
}

/** Where `mono_get_root_domain` lives: absolute address = monoModuleStart + rootDomainFn */
export type MonoRootDomainLocation = {
  monoModuleStart: bigint;
  rootDomainFn: bigint;
};

export interface Platform {
  readonly name: "linux" | "windows";

  /** Finds every running hackmud process that has mono loaded and a window we can type into */
  findClients(): ResultAsync<HackmudValidPid[], PlatformError>;

  openMemory(pid: number): ResultAsync<MemorySource, MemoryReaderError>;

  /**
   * Readable memory regions of the process.
   * Regions with an empty `path` are anonymous/private memory, these get scanned for mono objects.
   */
  getMemoryRegions(pid: number): ResultAsync<ModuleInfo[], PlatformError>;

  findMonoRootDomain(
    pid: number,
    regions: ModuleInfo[],
    mr: MemoryReader
  ): ResultAsync<MonoRootDomainLocation, PlatformError>;

  sendText(target: KeyboardTarget, text: string): Promise<void>;
  sendKey(target: KeyboardTarget, key: KeyName): Promise<void>;
}
