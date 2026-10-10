import { platform } from "../platform/platform.service";
import type { KeyName } from "./virtualKeyboard.model";

export abstract class virtualKeyboard {
  static async sendTextToWindow(windowId: number, display: number, text: string): Promise<void> {
    await platform.sendText({ windowId, display }, text);
  }
  static async sendKeyToWindow(windowId: number, display: number, key: KeyName): Promise<void> {
    await platform.sendKey({ windowId, display }, key);
  }
}
