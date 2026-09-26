import { agentNativePath } from "./api-path.js";

export interface OpenOAuthPopupOptions {
  initialUrl?: string;
  features?: string;
}

export function oauthPopupWaitingUrl(): string {
  if (typeof window === "undefined") return "";
  return new URL(
    agentNativePath("/_agent-native/oauth/popup"),
    window.location.href,
  ).href;
}

export function openOAuthPopup({
  initialUrl,
  features,
}: OpenOAuthPopupOptions = {}): Window | null {
  if (typeof window === "undefined") return null;
  const url = new URL(
    initialUrl || oauthPopupWaitingUrl(),
    window.location.href,
  );
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return window.open(url.href, "_blank", features);
}
