import * as path from "path";

// Kept free of app imports on purpose: config and the logger need these before anything else loads.

/** true when running as a standalone exe built with `bun build --compile` */
export const isCompiled = !/[\\/]bun(\.exe)?$/i.test(process.execPath);

/** backend/ when running from source, the folder of the exe when compiled */
export const appRoot = isCompiled
  ? path.dirname(process.execPath)
  : path.resolve(import.meta.dir, "../../..");

export const dataPaths =
  process.platform === "win32"
    ? {
        logs: path.join(appRoot, "logs"),
        cache: path.join(appRoot, "cache"),
        /** built dashboard served by the backend in packaged builds */
        dashboard: path.join(appRoot, "dashboard"),
        settings: path.join(appRoot, "settings.json"),
      }
    : {
        logs: "/logs",
        cache: "/app/backend/cache",
        dashboard: "/app/dashboard",
        settings: "/app/backend/cache/settings.json",
      };
