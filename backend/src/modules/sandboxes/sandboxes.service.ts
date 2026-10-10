import * as fs from "fs";
import * as path from "path";
import { err, ok, type Result, type ResultAsync } from "neverthrow";
import { toResultAsync } from "@backend/utils/neverthrow";
import { log } from "@backend/plugins/logger/logger";
import { sleep } from "@backend/utils/sleep";
import { listProcesses } from "../platform/windows/windows.platform";
import { settingsService } from "../settings/settings.service";
import type { AutoStart, Sandbox, SandboxError, SandboxListResponse } from "./sandboxes.model";

// Sandboxie-Plus boxes that each run their own Steam, so several hackmud accounts can run at once.
// Only boxes named HackmudAlt, HackmudAlt2, HackmudAlt3... are managed, any other sandbox is left alone

const BOX_PREFIX = "HackmudAlt";
const BOX_NAME = /^HackmudAlt(\d*)$/;
const HACKMUD_APP_ID = "469920";

const isSupported = process.platform === "win32";

function sandboxieDir() {
  const programFiles = process.env.ProgramW6432 ?? process.env.ProgramFiles ?? "C:\\Program Files";
  return path.join(programFiles, "Sandboxie-Plus");
}
const sbieIni = () => path.join(sandboxieDir(), "SbieIni.exe");
const sbieStart = () => path.join(sandboxieDir(), "Start.exe");
const isSandboxieInstalled = () => fs.existsSync(sbieIni());

function sandboxError(message: string): SandboxError {
  return { type: "SANDBOX_ERROR", message };
}

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const lines = stdout
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  return { code, stdout, lines };
}

/** For commands that start long running programs: their output pipes would never close */
async function runDetached(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  return proc.exited;
}

function boxNumber(name: string) {
  const n = BOX_NAME.exec(name)?.[1];
  return n ? Number(n) : 1;
}

async function isEnabled(name: string) {
  const r = await run([sbieIni(), "query", name, "Enabled"]);
  return r.lines[0]?.toLowerCase() == "y";
}

/** Sandboxie keeps an empty section around after a box is removed, so a box only counts if it's enabled */
async function managedBoxNames(): Promise<string[]> {
  const sections = (await run([sbieIni(), "query", "*"])).lines.filter(n => BOX_NAME.test(n));
  const names: string[] = [];
  for (const name of sections) if (await isEnabled(name)) names.push(name);
  return names.sort((a, b) => boxNumber(a) - boxNumber(b));
}

async function boxPids(name: string): Promise<number[]> {
  // first line is the process count, then one pid per line
  const r = await run([sbieStart(), `/box:${name}`, "/listpids"]);
  return r.lines
    .slice(1)
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0);
}

async function steamExe(): Promise<string | undefined> {
  const r = await run(["reg", "query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamExe"]);
  const match = /SteamExe\s+REG_SZ\s+(.+)/i.exec(r.stdout);
  return match?.[1]?.trim().replaceAll("/", "\\");
}

async function reload() {
  await run([sbieStart(), "/reload"]);
}

async function checkManagedBox(name: string): Promise<Result<string, SandboxError>> {
  if (!isSupported) return err(sandboxError("Sandboxes are only supported on Windows"));
  if (!isSandboxieInstalled()) return err(sandboxError("Sandboxie-Plus is not installed"));
  if (!BOX_NAME.test(name)) return err(sandboxError(`${name} is not a hacked mud sandbox`));
  if (!(await isEnabled(name))) return err(sandboxError(`Sandbox ${name} does not exist`));
  return ok(name);
}

// create/delete edit Sandboxie's config, don't let two requests do that at the same time
let configQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = configQueue.then(fn, fn);
  configQueue = next.catch(() => undefined);
  return next;
}

async function catchAll<T>(fn: () => Promise<Result<T, SandboxError>>) {
  try {
    return await fn();
  } catch (e) {
    log.error("Sandbox operation failed {*}", { e });
    return err(sandboxError((e as Error).message));
  }
}

export abstract class sandboxesService {
  static list(): ResultAsync<SandboxListResponse, SandboxError> {
    return toResultAsync(
      catchAll<SandboxListResponse>(async () => {
        if (!isSupported) return ok({ supported: false, sandboxieInstalled: false, boxes: [] });
        if (!isSandboxieInstalled())
          return ok({ supported: true, sandboxieInstalled: false, boxes: [] });

        const exeByPid = new Map<number, string>();
        const procs = listProcesses();
        if (procs.isOk()) for (const p of procs.value) exeByPid.set(p.pid, p.exe.toLowerCase());

        const settings = settingsService.load();
        const boxes: Sandbox[] = [];
        for (const name of await managedBoxNames()) {
          const pids = await boxPids(name);
          boxes.push({
            name,
            pids,
            steamRunning: pids.some(pid => exeByPid.get(pid) == "steam.exe"),
            hackmudPids: pids.filter(pid => exeByPid.get(pid) == "hackmud_win.exe"),
            autoStart: settings.sandboxes[name]?.autoStart ?? "off",
          });
        }
        return ok({ supported: true, sandboxieInstalled: true, boxes });
      })
    );
  }

  /** Creates the next free HackmudAltN sandbox */
  static create(): ResultAsync<{ name: string }, SandboxError> {
    return toResultAsync(
      serialized(() =>
        catchAll(async () => {
          if (!isSupported) return err(sandboxError("Sandboxes are only supported on Windows"));
          if (!isSandboxieInstalled()) return err(sandboxError("Sandboxie-Plus is not installed"));

          const used = new Set((await managedBoxNames()).map(boxNumber));
          let n = 1;
          while (used.has(n)) n++;
          const name = n == 1 ? BOX_PREFIX : `${BOX_PREFIX}${n}`;

          await run([sbieIni(), "set", name, "Enabled", "y"]);
          await reload();
          if (!(await isEnabled(name)))
            return err(sandboxError(`Sandboxie did not create ${name}`));

          // Steam inside the box would otherwise auto-login as the main account.
          // This runs inside the box, so it only touches the box's copy of the registry
          await run([
            sbieStart(),
            `/box:${name}`,
            "/wait",
            "reg.exe",
            "delete",
            "HKCU\\Software\\Valve\\Steam",
            "/v",
            "AutoLoginUser",
            "/f",
          ]);

          log.info("Created sandbox {name}", { name });
          return ok({ name });
        })
      )
    );
  }

  static launch(
    name: string,
    target: "steam" | "hackmud"
  ): ResultAsync<{ name: string }, SandboxError> {
    return toResultAsync(
      catchAll(async () => {
        const box = await checkManagedBox(name);
        if (box.isErr()) return err(box.error);

        const steam = await steamExe();
        if (!steam || !fs.existsSync(steam)) return err(sandboxError("Steam is not installed"));

        // with Steam already running in the box this just hands -applaunch to it
        const args = target == "hackmud" ? ["-applaunch", HACKMUD_APP_ID] : [];
        await runDetached([sbieStart(), `/box:${name}`, steam, ...args]);
        log.info("Launched {target} in sandbox {name}", { target, name });
        return ok({ name });
      })
    );
  }

  /** Closes everything running in the sandbox (Steam, hackmud...) */
  static stop(name: string): ResultAsync<{ name: string }, SandboxError> {
    return toResultAsync(
      catchAll(async () => {
        const box = await checkManagedBox(name);
        if (box.isErr()) return err(box.error);

        await run([sbieStart(), `/box:${name}`, "/terminate"]);
        for (let i = 0; i < 20 && (await boxPids(name)).length > 0; i++) await sleep(500);
        return ok({ name });
      })
    );
  }

  static remove(
    name: string,
    deleteContents: boolean
  ): ResultAsync<{ name: string }, SandboxError> {
    return toResultAsync(
      serialized(() =>
        catchAll(async () => {
          const stopped = await this.stop(name);
          if (stopped.isErr()) return err(stopped.error);

          if (deleteContents) await run([sbieStart(), `/box:${name}`, "delete_sandbox_silent"]);

          // a section disappears once all of its values are gone. SbieIni can only delete one value at a time
          for (const key of (await run([sbieIni(), "query", name])).lines) {
            for (const value of (await run([sbieIni(), "query", name, key])).lines) {
              await run([sbieIni(), "delete", name, key, value]);
            }
          }
          await reload();

          settingsService.update(s => {
            delete s.sandboxes[name];
          });
          log.info("Removed sandbox {name} (contents deleted: {deleteContents})", {
            name,
            deleteContents,
          });
          return ok({ name });
        })
      )
    );
  }

  static setAutoStart(
    name: string,
    autoStart: AutoStart
  ): ResultAsync<{ name: string }, SandboxError> {
    return toResultAsync(
      catchAll(async () => {
        const box = await checkManagedBox(name);
        if (box.isErr()) return err(box.error);
        settingsService.update(s => {
          s.sandboxes[name] = { autoStart };
        });
        return ok({ name });
      })
    );
  }

  /** Called once when hacked mud starts */
  static async autoStart() {
    if (!isSupported || !isSandboxieInstalled()) return;
    const list = await this.list();
    if (list.isErr()) return log.warn("Sandbox auto start failed {*}", { error: list.error });

    for (const box of list.value.boxes) {
      if (box.autoStart == "off") continue;
      if (box.autoStart == "steam" && box.steamRunning) continue;
      if (box.autoStart == "hackmud" && box.hackmudPids.length > 0) continue;
      const res = await this.launch(box.name, box.autoStart);
      if (res.isErr()) log.warn("Sandbox auto start failed {*}", { error: res.error });
    }
  }
}
