import { err, ok, type Result, type ResultAsync } from "neverthrow";
import { toResultAsync, type UnsupportedError } from "@backend/utils/neverthrow";
import type { MemoryReader } from "../../memoryReader/memoryReader.service";
import type { MemoryReaderError } from "../../memoryReader/memoryReader.models";

// https://learn.microsoft.com/en-us/windows/win32/debug/pe-format
const IMAGE_DOS_E_LFANEW = 0x3c;
const IMAGE_NT_SIGNATURE = 0x00004550; // "PE\0\0"
const IMAGE_NT_OPTIONAL_HDR64_MAGIC = 0x20b;
const OPTIONAL_HEADER_OFFSET = 24; // after Signature(4) + FileHeader(20)
const EXPORT_DIRECTORY_ENTRY_OFFSET = 112; // DataDirectory[0] in PE32+ optional header
const EXPORT_DIRECTORY_SIZE = 40;

/**
 * Finds an exported function of a module that is already mapped into the target process.
 * Since the image is mapped, RVAs can be used as offsets from the module base directly.
 * Returns the RVA of the export (absolute address = moduleBase + rva).
 */
export function findPeExport(
  mr: MemoryReader,
  moduleBase: bigint,
  exportName: string
): ResultAsync<bigint | undefined, MemoryReaderError | UnsupportedError> {
  return toResultAsync(_findPeExport(mr, moduleBase, exportName));
}

async function _findPeExport(
  mr: MemoryReader,
  base: bigint,
  exportName: string
): Promise<Result<bigint | undefined, MemoryReaderError | UnsupportedError>> {
  const lfanewRes = await mr.readUInt32(base + BigInt(IMAGE_DOS_E_LFANEW));
  if (lfanewRes.isErr()) return err(lfanewRes.error);
  const nt = base + BigInt(lfanewRes.value);

  const sigRes = await mr.readUInt32(nt);
  if (sigRes.isErr()) return err(sigRes.error);
  if (sigRes.value != IMAGE_NT_SIGNATURE)
    return err({ type: "UNSUPPORTED", message: "Not a PE image" } satisfies UnsupportedError);

  const optionalHeader = nt + BigInt(OPTIONAL_HEADER_OFFSET);
  const magicRes = await mr.readUInt16(optionalHeader);
  if (magicRes.isErr()) return err(magicRes.error);
  if (magicRes.value != IMAGE_NT_OPTIONAL_HDR64_MAGIC)
    return err({
      type: "UNSUPPORTED",
      message: "Only PE32+ is supported",
    } satisfies UnsupportedError);

  const exportRvaRes = await mr.readUInt32(optionalHeader + BigInt(EXPORT_DIRECTORY_ENTRY_OFFSET));
  if (exportRvaRes.isErr()) return err(exportRvaRes.error);
  if (exportRvaRes.value == 0) return ok(undefined);

  const dirRes = await mr.readBytes(base + BigInt(exportRvaRes.value), EXPORT_DIRECTORY_SIZE);
  if (dirRes.isErr()) return err(dirRes.error);
  const dir = dirRes.value;
  const numberOfNames = dir.readUInt32LE(24);
  const addressOfFunctions = BigInt(dir.readUInt32LE(28));
  const addressOfNames = BigInt(dir.readUInt32LE(32));
  const addressOfNameOrdinals = BigInt(dir.readUInt32LE(36));

  const namesRes = await mr.readBytes(base + addressOfNames, numberOfNames * 4);
  if (namesRes.isErr()) return err(namesRes.error);
  const ordinalsRes = await mr.readBytes(base + addressOfNameOrdinals, numberOfNames * 2);
  if (ordinalsRes.isErr()) return err(ordinalsRes.error);

  // compare including the null terminator so "foo" doesn't match "foobar"
  const wanted = Buffer.from(exportName + "\0", "ascii");

  for (let i = 0; i < numberOfNames; i++) {
    const nameRva = BigInt(namesRes.value.readUInt32LE(i * 4));
    const nameRes = await mr.readBytes(base + nameRva, wanted.length);
    if (nameRes.isErr() || !nameRes.value.equals(wanted)) continue;

    const ordinal = ordinalsRes.value.readUInt16LE(i * 2);
    const fnRes = await mr.readUInt32(base + addressOfFunctions + BigInt(ordinal * 4));
    if (fnRes.isErr()) return err(fnRes.error);
    return ok(BigInt(fnRes.value));
  }

  return ok(undefined);
}
