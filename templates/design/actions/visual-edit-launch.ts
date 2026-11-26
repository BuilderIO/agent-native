import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  DESKTOP_DEEP_LINK_PROTOCOLS,
  toDesktopOpenUrl,
  type DesktopDeepLinkProtocol,
} from "@agent-native/core/server";

import type {
  VisualEditLaunchResult,
  VisualEditLaunchTarget,
} from "../shared/visual-edit-launch.js";

const execute = promisify(execFile);

async function hasSchemeHandler(scheme: DesktopDeepLinkProtocol) {
  try {
    if (process.platform === "darwin") {
      const handler = await execute(
        "osascript",
        [
          "-l",
          "JavaScript",
          "-e",
          `ObjC.import("AppKit"); const app = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("${scheme}://open")); app.isNil() ? "" : app.path.js`,
        ],
        { timeout: 5_000 },
      );
      return Boolean(handler.stdout.trim());
    }
    if (process.platform === "linux") {
      const handler = await execute(
        "xdg-mime",
        ["query", "default", `x-scheme-handler/${scheme}`],
        { timeout: 5_000 },
      );
      return Boolean(handler.stdout.trim());
    }
    if (process.platform === "win32") {
      await execute("reg", ["query", `HKCU\\Software\\Classes\\${scheme}`], {
        timeout: 5_000,
      });
      return true;
    }
    return false;
    // coercion-ok: a failed handler query means this scheme is not registered
  } catch {
    return false;
  }
}

/** Stable wins when both channels are installed; nightly is the fallback. */
async function detectDesktopProtocol(): Promise<DesktopDeepLinkProtocol | null> {
  for (const scheme of DESKTOP_DEEP_LINK_PROTOCOLS) {
    if (await hasSchemeHandler(scheme)) return scheme;
  }
  return null;
}

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

  let launch = result;
  if (options.target === "desktop") {
    const desktopProtocol = await detectDesktopProtocol();
    if (!desktopProtocol) {
      return {
        ...result,
        status: "desktop-not-detected",
        message:
          "Desktop app not detected. Open browserUrl in a browser instead.",
      };
    }
    launch = {
      ...result,
      desktopProtocol,
      desktopUrl: toDesktopOpenUrl(options.openUrl, desktopProtocol),
    };
  }
  const url = options.target === "desktop" ? launch.desktopUrl : browserUrl;
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
    return { ...launch, status: "dispatched" };
  } catch {
    return {
      ...launch,
      status: "failed",
      message:
        "The operating system could not launch this target. Open browserUrl instead.",
    };
  }
}
