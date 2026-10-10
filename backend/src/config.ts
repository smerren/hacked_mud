import { isCompiled } from "./modules/platform/paths";

// packaged builds (bun build --compile) ship without a .env, so they get defaults. Real env vars still win
if (isCompiled) {
  process.env.NODE_ENV ??= "production";
  process.env.API_BASE_URL ??= "/hacked_mud_api";
  process.env.API_FULL_URL ??= "http://localhost:3000/hacked_mud_api";
  process.env.LOGGER_LEVEL ??= "info";
}

function notNull<T>(name: string, a: T) {
  if (a === null || a === undefined) throw new Error("Empty env variable! " + name);
  return a as Exclude<T, null | undefined>;
}

export namespace env {
  export const NODE_ENV = notNull("NODE_ENV", process.env.NODE_ENV);
  export const API_BASE_URL = notNull("API_BASE_URL", process.env.API_BASE_URL);
  export const API_FULL_URL = notNull("API_FULL_URL", process.env.API_FULL_URL);
  export const LOGGER_LEVEL = process.env.LOGGER_LEVEL || "debug";
  export const DEPLOY = process.env.DEPLOY === "true" ? true : false;
}

export const isDevelopment = env.NODE_ENV === "development";
