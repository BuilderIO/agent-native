import type { ActiveWebviewTarget } from "@shared/ipc-channels";
import type { WebContents } from "electron";

type BackgroundThrottlingContents = Pick<
  WebContents,
  "getType" | "setBackgroundThrottling"
>;

export function restoreMailWebviewBackgroundThrottling(
  target: Pick<ActiveWebviewTarget, "appId" | "webContentsId">,
  getWebContents: (id: number) => BackgroundThrottlingContents | undefined,
): void {
  if (target.appId !== "mail" || typeof target.webContentsId !== "number") {
    return;
  }

  const contents = getWebContents(target.webContentsId);
  if (contents?.getType() !== "webview") return;
  contents.setBackgroundThrottling(true);
}
