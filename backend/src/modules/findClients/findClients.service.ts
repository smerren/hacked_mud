import { log } from "@backend/plugins/logger/logger";
import { errAsync, ok, okAsync, Result, ResultAsync } from "neverthrow";
import { toResultAsync } from "@backend/utils/neverthrow";
import { socketServerService } from "../socketServer/socketServer.service";
import { HackmudClient } from "../hackmudClient/hackmudClient.service";
import type { ClientNotFoundError } from "./findClients.models";
import { OOG } from "../OOG/oog.service";
import { platform } from "../platform/platform.service";
import type { HackmudValidPid, PlatformError } from "../platform/platform.types";
// import { HackmudClient } from "../hackmudClient/hackmudClient.service";

export type { HackmudValidPid } from "../platform/platform.types";
export const HackmudClients = new Map<number, HackmudClient>();
export const HackmudOOGs = new Map<number, OOG>();

export abstract class findClientsService {
  static isRepopulating: boolean = false;
  static findClients(): ResultAsync<HackmudValidPid[], PlatformError> {
    return platform.findClients();
  }

  static repopulateMemReaders() {
    if (this.isRepopulating) return;
    this.isRepopulating = true;
    log.info("Starting to look for clients");

    return findClientsService
      .findClients()
      .andThen(clients => {
        const toRemove = HackmudClients.entries()
          .toArray()
          .filter(k => !clients.find(c => c.pid == k[0]));
        for (const expired of toRemove) {
          this.deleteClient(expired[0]);
        }

        return ok(clients);
      })
      .andThen(clients => {
        async function temp(): Promise<Result<HackmudClient[], never>> {
          const res: HackmudClient[] = [];
          for (const c of clients) {
            if (HackmudClients.keys().find(a => a == c.pid)) continue;

            const listener = await HackmudClient.create(
              c,
              socketServerService.onHackmudEvent.bind(socketServerService)
            );

            if (listener.isErr()) {
              log.error({ error: listener.error });
              continue;
            }

            const oog = await OOG.create(listener.value);
            if (oog.isErr()) {
              log.error({ error: oog.error });
              continue;
            }
            HackmudOOGs.set(c.pid, oog.value);

            HackmudClients.set(c.pid, listener.value);
            res.push(listener.value);
          }
          return ok(res);
        }

        return toResultAsync(temp());
      })
      .andTee(clients => {
        log.info("Finished looking for clients");
        log.info({ pids: HackmudClients.keys().toArray() });
        if (clients.length > 0) {
          socketServerService.broadcastClientList();
        }
        this.isRepopulating = false;
      })
      .orTee(e => {
        log.error("Error while looking for clients", { e });
        log.info({ pids: HackmudClients.keys().toArray() });
        this.isRepopulating = false;
      });
  }

  static getClient(pid: number): ResultAsync<HackmudClient, ClientNotFoundError> {
    const hm = HackmudClients.get(pid);
    if (!hm) {
      return errAsync({
        type: "CLIENT_NOT_FOUND",
        pid,
      } satisfies ClientNotFoundError);
    }
    return okAsync(hm);
  }

  static getOOG(pid: number): ResultAsync<OOG, ClientNotFoundError> {
    const hm = HackmudOOGs.get(pid);
    if (!hm) {
      return errAsync({
        type: "CLIENT_NOT_FOUND",
        pid,
      } satisfies ClientNotFoundError);
    }
    return okAsync(hm);
  }

  static deleteClient(pid: number) {
    if (HackmudClients.has(pid)) {
      HackmudClients.get(pid)!.stop();
      HackmudClients.delete(pid);
      socketServerService.broadcastClientList();
      log.info(`Deleting client ${pid}`);
    }
    if (HackmudOOGs.has(pid)) {
      HackmudOOGs.get(pid)!.stop();
      HackmudOOGs.delete(pid);
      log.info(`Deleting OOG ${pid}`);
    }
  }
}

try {
  void findClientsService.repopulateMemReaders();
} catch (e) {
  log.error({ e });
}

setInterval(() => {
  try {
    void findClientsService.repopulateMemReaders();
  } catch (e) {
    log.error({ e });
  }
}, 1000 * 60);
