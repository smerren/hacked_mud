import Elysia, { status } from "elysia";
import { loggerConfigPlugin } from "@backend/plugins/logger/logger.plugin";
import {
  DeleteRequestT,
  LaunchRequestT,
  SandboxListResponseT,
  SandboxNameRequestT,
  SetAutoStartRequestT,
  type SandboxError,
} from "./sandboxes.model";
import { sandboxesService } from "./sandboxes.service";

function fail(e: SandboxError): never {
  throw status(400, e);
}

const tags = ["Sandboxes"];

export const sandboxesHandler = new Elysia()
  .use(loggerConfigPlugin)
  .get("sandboxes", async () => sandboxesService.list().match(a => a, fail), {
    response: { 200: SandboxListResponseT },
    detail: {
      summary: "List sandboxes",
      description: "Sandboxie-Plus sandboxes used to run additional Steam accounts (Windows only)",
    },
    tags,
    loggerConfig: { toLog: false },
  })
  .post("sandboxes/create", async () => sandboxesService.create().match(a => a, fail), {
    detail: { summary: "Create the next HackmudAltN sandbox" },
    tags,
  })
  .post(
    "sandboxes/launch",
    async ({ body }) => sandboxesService.launch(body.name, body.target).match(a => a, fail),
    {
      body: LaunchRequestT,
      detail: { summary: "Start Steam (or Steam + hackmud) inside a sandbox" },
      tags,
    }
  )
  .post(
    "sandboxes/stop",
    async ({ body }) => sandboxesService.stop(body.name).match(a => a, fail),
    {
      body: SandboxNameRequestT,
      detail: { summary: "Close everything running inside a sandbox" },
      tags,
    }
  )
  .post(
    "sandboxes/delete",
    async ({ body }) => sandboxesService.remove(body.name, body.deleteContents).match(a => a, fail),
    {
      body: DeleteRequestT,
      detail: { summary: "Remove a sandbox, optionally with its files (Steam login, scripts)" },
      tags,
    }
  )
  .post(
    "sandboxes/autoStart",
    async ({ body }) =>
      sandboxesService.setAutoStart(body.name, body.autoStart).match(a => a, fail),
    {
      body: SetAutoStartRequestT,
      detail: { summary: "Choose what starts inside a sandbox when hacked mud starts" },
      tags,
    }
  );
