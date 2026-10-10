// Quick check of the windows platform layer against running hackmud clients.
// Usage (from backend/): bun run scripts/windows-smoke.ts [--type "accts.balance"]
//
// --type sends Escape, the text and Return to every client found, which tests virtual input.

export {};

process.env.NODE_ENV ??= "development";
process.env.API_BASE_URL ??= "/";
process.env.API_FULL_URL ??= "http://localhost";

const { windowsPlatform: p } = await import("../src/modules/platform/windows/windows.platform");
const { MemoryReader } = await import("../src/modules/memoryReader/memoryReader.service");

const typeIdx = process.argv.indexOf("--type");
const toType = typeIdx >= 0 ? process.argv[typeIdx + 1] : undefined;

const clients = await p.findClients();
if (clients.isErr()) {
  console.error("findClients failed", clients.error);
  process.exit(1);
}
console.log("clients:", clients.value);
if (clients.value.length == 0) console.log("No clients found. Is hackmud_win.exe running?");

for (const c of clients.value) {
  console.log(`\n=== pid ${c.pid} hwnd 0x${c.windowId.toString(16)}`);

  const mr = (await MemoryReader.create(c.pid))._unsafeUnwrap();

  const regions = (await p.getMemoryRegions(c.pid))._unsafeUnwrap();
  const anon = regions.filter(r => !r.path);
  const anonMb = Number(anon.reduce((a, r) => a + r.size, 0n)) / 1024 / 1024;
  console.log(`regions: ${regions.length}, anonymous: ${anon.length} (${anonMb.toFixed(1)} MB)`);

  const loc = (await p.findMonoRootDomain(c.pid, regions, mr))._unsafeUnwrap();
  const fnAddr = loc.monoModuleStart + loc.rootDomainFn;
  const bytes = (await mr.readBytes(fnAddr, 8))._unsafeUnwrap();
  console.log(
    `mono_get_root_domain @ 0x${fnAddr.toString(16)}: ${bytes.toString("hex")}`,
    bytes[0] == 0x48 && bytes[1] == 0x8b && bytes[2] == 0x05 && bytes[7] == 0xc3
      ? "(mov rax,[rip+X]; ret - OK)"
      : "(UNEXPECTED - monoParser expects 48 8b 05 xx xx xx xx c3)"
  );

  if (toType) {
    await p.sendKey(c, "Escape");
    await Bun.sleep(20);
    await p.sendText(c, toType);
    await Bun.sleep(20);
    await p.sendKey(c, "Return");
    console.log(`sent "${toType}" - check the game window`);
  }

  await mr.close();
}
