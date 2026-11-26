import type { ActiveWebviewTarget } from "@shared/ipc-channels";
import type { WebContents } from "electron";

type BackgroundThrottlingContents = Pick<
  WebContents,
  "getType" | "setBackgroundThrottling"
>;

export function setMailWebviewBackgroundThrottling(
  target: Pick<ActiveWebviewTarget, "active" | "appId" | "webContentsId">,
  getWebContents: (id: number) => BackgroundThrottlingContents | undefined,
): void {
  if (target.appId !== "mail" || typeof target.webContentsId !== "number") {
    return;
  }

  const contents = getWebContents(target.webContentsId);
  if (contents?.getType() !== "webview") return;
  contents.setBackgroundThrottling(target.active !== false);
}

export function setWebviewBackgroundThrottling(
  request: unknown,
  getWebContents: (id: number) => BackgroundThrottlingContents | undefined,
): void {
  if (typeof request !== "object" || request === null) return;
  const { webContentsId, throttle } = request as {
    webContentsId?: unknown;
    throttle?: unknown;
  };
  if (typeof webContentsId !== "number" || typeof throttle !== "boolean") {
    return;
  }
  const contents = getWebContents(webContentsId);
  if (contents?.getType() !== "webview") return;
  contents.setBackgroundThrottling(throttle);
}
