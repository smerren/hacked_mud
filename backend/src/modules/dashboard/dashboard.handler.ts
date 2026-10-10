import Elysia from "elysia";
import * as fs from "fs";
import * as path from "path";
import { dataPaths } from "../platform/paths";

export const DASHBOARD_BASE_URL = "/hacked_mud_dashboard";

/** The built dashboard (frontend/dist/spa) only exists next to the app in packaged builds */
export const isDashboardAvailable = fs.existsSync(path.join(dataPaths.dashboard, "index.html"));

function resolveFile(urlPath: string): string {
  const root = path.resolve(dataPaths.dashboard);
  let decoded = urlPath;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    // keep the raw path
  }
  const requested = path.resolve(root, decoded);
  const insideRoot = requested.startsWith(root + path.sep);
  if (insideRoot && fs.existsSync(requested) && fs.statSync(requested).isFile()) return requested;

  // vue-router runs in history mode, so unknown paths get the app itself
  return path.join(root, "index.html");
}

/** Serves the dashboard from the backend so a packaged install is a single process on a single port */
export const dashboardHandler = new Elysia({ name: "dashboard" })
  .get("/", ({ redirect }) => redirect(DASHBOARD_BASE_URL + "/"))
  // elysia matches this route with and without the trailing slash, so check the real path to avoid a redirect loop
  .get(DASHBOARD_BASE_URL, ({ request, redirect }) =>
    new URL(request.url).pathname.endsWith("/")
      ? Bun.file(resolveFile(""))
      : redirect(DASHBOARD_BASE_URL + "/")
  )
  .get(`${DASHBOARD_BASE_URL}/*` as const, ({ params }) => Bun.file(resolveFile(params["*"])));
