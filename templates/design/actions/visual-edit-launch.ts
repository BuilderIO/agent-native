import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { toDesktopOpenUrl } from "@agent-native/core/server";

import type {
  VisualEditLaunchResult,
  VisualEditLaunchTarget,
} from "../shared/visual-edit-launch.js";

const execute = promisify(execFile);

export async function launchVisualEdit(options: {
  target: VisualEditLaunchTarget;
  openUrl: string;
  origin?: string;
  localCli: boolean;
  navigate: boolean;
}): Promise<VisualEditLaunchResult> {
  const browserUrl = new URL(
    options.openUrl,
    options.origin ?? "https://design.agent-native.com",
  ).toString();
  const result: VisualEditLaunchResult = {
    target: options.target,
    status: options.target === "inline-browser" ? "inline" : "host-required",
    browserUrl,
    desktopUrl: toDesktopOpenUrl(options.openUrl),
  };
  if (!options.navigate || options.target === "inline-browser") return result;
  // Hosted actions cannot inspect or launch applications on the caller's machine.
  if (!options.localCli) return result;

  if (options.target === "desktop") {
    const notDetected: VisualEditLaunchResult = {
      ...result,
      status: "desktop-not-detected",
      message:
        "Desktop app not detected. Open browserUrl in a browser instead.",
    };
    try {
      if (process.platform === "darwin") {
        await execute("open", ["-Ra", "Agent-Native"], { timeout: 5_000 });
      } else if (process.platform === "linux") {
        const handler = await execute(
          "xdg-mime",
          ["query", "default", "x-scheme-handler/agentnative"],
          { timeout: 5_000 },
        );
        if (!handler.stdout.trim()) return notDetected;
      } else if (process.platform === "win32") {
        await execute(
          "reg",
          ["query", "HKCU\\Software\\Classes\\agentnative"],
          {
            timeout: 5_000,
          },
        );
      } else {
        return notDetected;
      }
    } catch {
      return notDetected;
    }
  }
  const url = options.target === "desktop" ? result.desktopUrl : browserUrl;
  try {
    if (process.platform === "darwin") {
      await execute("open", [url], { timeout: 5_000 });
    } else if (process.platform === "win32") {
      await execute("rundll32", ["url.dll,FileProtocolHandler", url], {
        timeout: 5_000,
      });
    } else {
      await execute("xdg-open", [url], { timeout: 5_000 });
    }
    return { ...result, status: "dispatched" };
  } catch {
    return {
      ...result,
      status: "failed",
      message:
        "The operating system could not launch this target. Open browserUrl instead.",
    };
  }
}
