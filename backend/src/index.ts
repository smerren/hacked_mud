import Elysia from "elysia";
import { env } from "./config";
import { log } from "./plugins/logger/logger";
import { apiApp } from "./apiApp";
import {
  DASHBOARD_BASE_URL,
  dashboardHandler,
  isDashboardAvailable,
} from "./modules/dashboard/dashboard.handler";
import { isCompiled } from "./modules/platform/paths";
import { sandboxesService } from "./modules/sandboxes/sandboxes.service";

const PORT = Number(process.env.PORT) || 3000;
const DASHBOARD_URL = `http://localhost:${PORT}${DASHBOARD_BASE_URL}/`;

const app = new Elysia();
if (isDashboardAvailable) app.use(dashboardHandler);
app.use(apiApp);

/** Packaged windows builds open the dashboard themselves, there's no other UI */
function openDashboardInBrowser() {
  if (!isCompiled || process.platform !== "win32" || !isDashboardAvailable) return;
  Bun.spawn(["cmd", "/c", "start", "", DASHBOARD_URL]);
}

const start = () => {
  log.info("===========================================================");
  log.info("Начинаем запуск приложения");

  try {
    // on windows reusePort lets a second instance silently share the port instead of failing
    app.listen({ port: PORT, reusePort: process.platform !== "win32" }, () => {
      const hostname = app.server?.hostname;
      const port = app.server?.port;
      log.info("API запущенно на {host} порт {port}", { host: hostname, port: port });
      log.info("NODE_ENV: {env}", { env: env.NODE_ENV });
      if (isDashboardAvailable) log.info("Dashboard: {url}", { url: DASHBOARD_URL });
      openDashboardInBrowser();
      void sandboxesService.autoStart();
    });

    const shutdown = async () => {
      log.info("Завершение работы...");
      if (app.server) await app.server.stop();
      process.exit(0);
    };

    process.on("SIGINT", () => {
      void shutdown();
    });
    process.on("SIGTERM", () => {
      void shutdown();
    });
  } catch (err) {
    const e = err as Error & { code?: string };
    // launching the packaged app twice: the first one is already serving, just show it
    // bun reports this as "Failed to start server. Is port 3000 in use?" without an error code
    const portInUse = e.code == "EADDRINUSE" || /port \d+ in use/i.test(e.message);
    if (portInUse && isCompiled) {
      log.info("Already running, opening the dashboard");
      openDashboardInBrowser();
      process.exit(0);
    }
    log.error("Ошибка при запуске приложения {*}", { e: e.message, stack: e.stack });
    process.exit(1);
  }
};

start();

// import { StructLayoutGenerator } from "./modules/structLayoutGenerator/structLayoutGenerator.service";
// import {
//   Elf32HeaderL,
//   Elf64HeaderL,
//   Elf64SectionHeaderL,
//   Elf64SymbolL,
//   ElfIdentL,
// } from "./modules/ElfParser/ElfParser.models";
// import { log } from "./plugins/logger/logger";
// import {
//   _MonoClassFieldL,
//   _MonoTypeL,
//   MonoClassRuntimeInfoL,
// } from "./modules/monoParser/monoParser.models";

// console.log(MonoClassRuntimeInfoL.visualize());
