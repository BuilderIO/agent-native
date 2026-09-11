export type ContentFilesWebviewDenialReason =
  | "sender-not-webview"
  | "content-not-active"
  | "sender-not-active-webview"
  | "content-app-unavailable"
  | "invalid-sender-url"
  | "untrusted-origin";

export interface ContentFilesWebviewAccessInput {
  senderType: string;
  senderId: number;
  senderUrl: string;
  activeAppId: string;
  activeWebviewContentsId?: number;
  contentAppAvailable: boolean;
  trustedOrigins: string[];
  developmentOrigins: string[];
  development: boolean;
}

export function contentFilesWebviewDenialReason({
  senderType,
  senderId,
  senderUrl,
  activeAppId,
  activeWebviewContentsId,
  contentAppAvailable,
  trustedOrigins,
  developmentOrigins,
  development,
}: ContentFilesWebviewAccessInput): ContentFilesWebviewDenialReason | null {
  if (senderType !== "webview") return "sender-not-webview";
  if (activeAppId !== "content") return "content-not-active";
  if (!activeWebviewContentsId || activeWebviewContentsId !== senderId) {
    return "sender-not-active-webview";
  }
  if (!contentAppAvailable) return "content-app-unavailable";

  let origin: string;
  try {
    origin = new URL(senderUrl).origin;
  } catch {
    return "invalid-sender-url";
  }
  if (trustedOrigins.includes(origin)) return null;
  if (development && developmentOrigins.includes(origin)) return null;
  return "untrusted-origin";
}
