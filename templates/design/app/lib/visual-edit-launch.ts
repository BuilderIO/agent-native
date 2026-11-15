import type { VisualEditLaunchResult } from "../../shared/visual-edit-launch.js";

export async function dispatchVisualEditBrowserLaunch(
  launch: VisualEditLaunchResult,
): Promise<VisualEditLaunchResult> {
  if (launch.target === "inline-browser") return launch;
  const host = window as typeof window & {
    agentNativeDesktop?: unknown;
    openai?: { openExternal?: (args: { href: string }) => unknown };
  };
  if (launch.target === "desktop" && !host.agentNativeDesktop) {
    return {
      ...launch,
      status: "desktop-not-detected",
      message:
        "Desktop app not detected by this browser. Verify the installed agentnative protocol handler locally, or open browserUrl instead.",
    };
  }
  const url =
    launch.target === "desktop" ? launch.desktopUrl : launch.browserUrl;
  try {
    if (host.openai?.openExternal) {
      await host.openai.openExternal({ href: url });
      return { ...launch, status: "dispatched" };
    }
    return {
      ...launch,
      status: "host-required",
      message: "Use the coding host's local opener for this launch target.",
    };
  } catch {
    return { ...launch, status: "failed" };
  }
}
