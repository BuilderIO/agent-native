import path from "node:path";

import type {
  CodeAgentComputerSetupAction,
  CodeAgentComputerSetupResult,
} from "@shared/ipc-channels";

export const MAC_ACCESSIBILITY_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
export const MAC_SCREEN_RECORDING_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

interface ComputerSetupDependencies {
  platform: string;
  requestAccessibility(): boolean;
  requestScreenRecording(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  extensionPath(): string;
  pathExists(filePath: string): boolean;
  revealExtensionFolder(folderPath: string): Promise<void>;
  openChromeExtensions(): void;
  restart(): void;
}

const SUPPORTED_ACTIONS = new Set<CodeAgentComputerSetupAction>([
  "request-accessibility",
  "request-screen-recording",
  "open-accessibility-settings",
  "open-screen-recording-settings",
  "open-chrome-setup",
  "restart",
]);

export async function runComputerSetupAction(
  input: unknown,
  dependencies: ComputerSetupDependencies,
): Promise<CodeAgentComputerSetupResult> {
  const action = input as CodeAgentComputerSetupAction;
  if (!SUPPORTED_ACTIONS.has(action)) {
    return {
      ok: false,
      action: "request-accessibility",
      message: "Unsupported computer access setup action.",
      error: "Unsupported computer access setup action.",
    };
  }

  try {
    if (dependencies.platform !== "darwin") {
      return {
        ok: false,
        action,
        message: "Computer access setup is currently available on macOS.",
        error: "Unsupported platform.",
      };
    }

    if (action === "request-accessibility") {
      const granted = dependencies.requestAccessibility();
      return {
        ok: true,
        action,
        message: granted
          ? "Accessibility access is ready."
          : "macOS opened the Accessibility permission prompt.",
        restartRecommended: !granted,
      };
    }

    if (action === "request-screen-recording") {
      const granted = await dependencies.requestScreenRecording();
      return {
        ok: true,
        action,
        message: granted
          ? "Screen Recording access is ready."
          : "macOS opened the Screen Recording permission prompt.",
        restartRecommended: !granted,
      };
    }

    if (action === "open-accessibility-settings") {
      await dependencies.openExternal(MAC_ACCESSIBILITY_SETTINGS_URL);
      return {
        ok: true,
        action,
        message: "Opened Accessibility settings.",
        restartRecommended: true,
      };
    }

    if (action === "open-screen-recording-settings") {
      await dependencies.openExternal(MAC_SCREEN_RECORDING_SETTINGS_URL);
      return {
        ok: true,
        action,
        message: "Opened Screen Recording settings.",
        restartRecommended: true,
      };
    }

    if (action === "open-chrome-setup") {
      const extensionPath = dependencies.extensionPath();
      if (!dependencies.pathExists(path.join(extensionPath, "manifest.json"))) {
        return {
          ok: false,
          action,
          message: "The bundled Chrome extension is not available.",
          error: "Chrome extension bundle is missing.",
        };
      }
      await dependencies.revealExtensionFolder(extensionPath);
      dependencies.openChromeExtensions();
      return {
        ok: true,
        action,
        message:
          "Opened Chrome Extensions and revealed the Agent Native extension folder.",
      };
    }

    dependencies.restart();
    return {
      ok: true,
      action,
      message: "Restarting Agent Native.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, action, message, error: message };
  }
}
