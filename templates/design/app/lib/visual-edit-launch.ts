import type { VisualEditLaunchResult } from "../../shared/visual-edit-launch.js";

export async function dispatchVisualEditBrowserLaunch(
  launch: VisualEditLaunchResult,
): Promise<VisualEditLaunchResult> {
  if (launch.target === "inline-browser") return launch;
  const host = window as typeof window & {
    agentNativeDesktop?: unknown;
    electronAPI?: { shell?: { openExternal?: (url: string) => Promise<void> } };
    openai?: { openExternal?: (args: { href: string }) => unknown };
  };
  if (launch.target === "desktop" && !host.agentNativeDesktop) {
    return {
      ...launch,
      status: "desktop-not-detected",
      message:
        "Desktop app not detected by this browser. Verify an installed agentnative or agentnative-nightly protocol handler locally, or open browserUrl instead.",
    };
  }
  const url =
    launch.target === "desktop" ? launch.desktopUrl : launch.browserUrl;
  try {
    if (launch.target === "desktop" && host.agentNativeDesktop) {
      if (host.electronAPI?.shell?.openExternal) {
        await host.electronAPI.shell.openExternal(url);
        return { ...launch, status: "dispatched" };
      }
      window.location.assign(launch.browserUrl);
      return { ...launch, status: "dispatched" };
    }
    if (host.openai?.openExternal) {
      await host.openai.openExternal({ href: url });
      return { ...launch, status: "dispatched" };
    }
    window.location.assign(url);
    return { ...launch, status: "dispatched" };
  } catch {
    return { ...launch, status: "failed" };
  }
}
