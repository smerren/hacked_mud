import { linuxPlatform } from "./linux/linux.platform";
import type { Platform } from "./platform.types";
import { windowsPlatform } from "./windows/windows.platform";

function selectPlatform(): Platform {
  switch (process.platform) {
    case "linux":
      return linuxPlatform;
    case "win32":
      return windowsPlatform;
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

export const platform: Platform = selectPlatform();
