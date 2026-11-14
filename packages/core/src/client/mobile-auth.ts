export type MobileGoogleAuthResult = "signed-in" | "cancelled" | "failed";

declare global {
  interface Window {
    __agentNativeMobileOAuth?: {
      start(url: string): Promise<MobileGoogleAuthResult>;
    };
  }
}

export function startMobileGoogleAuth(
  authUrl: string,
  returnPath: string,
): Promise<MobileGoogleAuthResult> | null {
  if (typeof window === "undefined" || !window.__agentNativeMobileOAuth) {
    return null;
  }
  const start = new URL(authUrl, window.location.href);
  start.searchParams.set("return", returnPath);
  return window.__agentNativeMobileOAuth.start(start.href);
}
