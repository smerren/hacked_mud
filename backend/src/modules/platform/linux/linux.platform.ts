import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import type { FileHandle } from "fs/promises";
import { err, errAsync, ok, ResultAsync } from "neverthrow";
import { log } from "@backend/plugins/logger/logger";
import type { ExecError, NullPointerError } from "@backend/utils/neverthrow";
import { getProcMaps } from "../../procParser/procParser.service";
import { ELFParser } from "../../ElfParser/ElfParser.service";
import type { MemoryReaderError } from "../../memoryReader/memoryReader.models";
import type { KeyName } from "../../virtualKeyboard/virtualKeyboard.model";
import type { HackmudValidPid, KeyboardTarget, MemorySource, Platform } from "../platform.types";

const execAsync = ResultAsync.fromThrowable(
  async (a: string) => promisify(exec)(a),
  e => {
    return {
      cause: e as Error,
      type: "EXEC_ERROR",
    } satisfies ExecError;
  }
);

const execAsyncRaw = promisify(exec);

const MONO_MODULE_NAME = "libmonobdwgc";

export type UselessPidError = {
  type: "USELESS_PID";
  pid: number;
};

class ProcMemSource implements MemorySource {
  constructor(private file: FileHandle) {}

  async read(buffer: Buffer, size: number, address: bigint): Promise<number> {
    const res = await this.file.read(buffer, 0, size, Number(address));
    return res.bytesRead;
  }

  async close(): Promise<void> {
    await this.file.close();
  }
}

function validatePid(pid: number): ResultAsync<HackmudValidPid, UselessPidError> {
  const ue = err({
    type: "USELESS_PID",
    pid,
  } satisfies UselessPidError);

  log.trace("Validating PID " + pid);

  return hasMono(pid)
    .andThen(has => {
      log.trace(pid + " Has mono? " + has);

      if (!has) return ue;
      return ok();
    })
    .andThen(_ => execAsync(`cat /proc/${pid}/environ | tr '\\0' '\n' | grep DISPLAY`))
    .map(envs => {
      log.trace(`cat /proc/${pid}/environ | tr '\\0' '\\n' | grep DISPLAY response {*}`, envs);

      return Number(envs.stdout.replaceAll("DISPLAY=:", "").trim());
    })
    .andThen(display =>
      execAsync(`DISPLAY=:${display} xdotool search --classname hackmud_lin.x86_64`).map(winId => {
        log.trace(
          `DISPLAY=:${display} xdotool search --classname hackmud_lin.x86_64 response {*}`,
          winId
        );
        return {
          pid,
          windowId: Number(winId.stdout),
          display,
        } satisfies HackmudValidPid;
      })
    )
    .orElse(e => {
      if (e.type == "EXEC_ERROR") {
        log.warn(e);
        return ue;
      }
      return err(e);
    });
}

function hasMono(pid: number): ResultAsync<boolean, never> {
  return getProcMaps(pid)
    .andThen(modules => {
      const mono = modules.find(m => m.path.includes(MONO_MODULE_NAME));
      return ok(!!mono);
    })
    .orElse(e => {
      switch (e.type) {
        case "EXEC_ERROR":
          log.warn(e);
          return ok(false);
        case "PROC_NOT_FOUND_ERROR":
          return ok(false);
      }
    });
}

export const linuxPlatform: Platform = {
  name: "linux",

  findClients() {
    return execAsync("pgrep -f hackmud").andThen(resp => {
      log.trace("pgrep -f hackmud {*} ", resp);
      const t = resp.stdout.trim();
      if (!t) {
        return ok([]);
      }
      const pids = t
        .split("\n")
        .map(pid => Number(pid))
        .filter(pid => !isNaN(pid));

      const results: ResultAsync<HackmudValidPid | undefined, never>[] = [];
      for (const pid of pids) {
        results.push(validatePid(pid).orElse(_ => ok(undefined)));
      }

      return ResultAsync.combine(results).andThen(valid => {
        return ok(valid.filter(a => !!a));
      });
    });
  },

  openMemory(pid) {
    const memPath = `/proc/${pid}/mem`;
    return ResultAsync.fromPromise(
      fs.promises.open(memPath, "r"),
      e =>
        ({
          type: "MEMORY_READER_ERROR",
          cause: e as Error,
        }) satisfies MemoryReaderError
    ).map(file => new ProcMemSource(file) as MemorySource);
  },

  getMemoryRegions(pid) {
    return getProcMaps(pid);
  },

  findMonoRootDomain(pid, regions, mr) {
    const monoModule = regions.find(m => m.path.includes(MONO_MODULE_NAME));
    if (!monoModule)
      return errAsync({ type: "NULL_POINTER_ERROR", var: "monoModule" } satisfies NullPointerError);

    return new ELFParser(mr, monoModule).parseElf().andThen(elf => {
      const monoDomain = elf.symbols.find(a => a.name == "mono_get_root_domain");
      if (!monoDomain)
        return err({ type: "NULL_POINTER_ERROR", var: "monoDomain" } satisfies NullPointerError);

      return ok({ monoModuleStart: monoModule.start, rootDomainFn: monoDomain.st_value });
    });
  },

  async sendText(target: KeyboardTarget, text: string) {
    const escapedText = text.replace(/"/g, '\\"');
    await execAsyncRaw(
      `DISPLAY=:${target.display} xdotool type --window ${target.windowId} --delay 0 "${escapedText}"`
    );
  },

  async sendKey(target: KeyboardTarget, key: KeyName) {
    await execAsyncRaw(`DISPLAY=:${target.display} xdotool key --window ${target.windowId} ${key}`);
  },
};
