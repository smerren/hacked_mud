import * as fs from "fs";
import * as path from "path";
import { log } from "@backend/plugins/logger/logger";
import { dataPaths } from "../platform/paths";
import type { AutoStart } from "../sandboxes/sandboxes.model";

/** User settings that can be changed from the dashboard while the app runs */
export type Settings = {
  sandboxes: Record<string, { autoStart: AutoStart }>;
};

function defaults(): Settings {
  return { sandboxes: {} };
}

export abstract class settingsService {
  static load(): Settings {
    try {
      if (!fs.existsSync(dataPaths.settings)) return defaults();
      const parsed = JSON.parse(fs.readFileSync(dataPaths.settings, "utf8")) as Partial<Settings>;
      return { ...defaults(), ...parsed };
    } catch (e) {
      log.warn("Could not read settings, using defaults {*}", { e });
      return defaults();
    }
  }

  static update(change: (settings: Settings) => void): Settings {
    const settings = this.load();
    change(settings);
    fs.mkdirSync(path.dirname(dataPaths.settings), { recursive: true });
    fs.writeFileSync(dataPaths.settings, JSON.stringify(settings, null, 2));
    return settings;
  }
}
