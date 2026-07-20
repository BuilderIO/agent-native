const ZOOM_JOIN_PATH = /^\/j\/(\d+)\/?$/;
const ZOOM_WEB_CLIENT_JOIN_PATH = /^\/wc\/(\d+)\/join\/?$/;

function isZoomMeetingHost(hostname: string): boolean {
  return hostname === "zoom.us" || hostname.endsWith(".zoom.us");
}

/**
 * Prefer Zoom's native URI when an HTTPS calendar link carries a meeting id.
 * Other providers and URL shapes retain their original URL as the safe
 * fallback.
 */
export function resolveNativeMeetingJoinUrl(joinUrl: string): string {
  try {
    const url = new URL(joinUrl);
    if (url.protocol !== "https:" || !isZoomMeetingHost(url.hostname)) {
      return joinUrl;
    }

    const meetingNumber =
      ZOOM_JOIN_PATH.exec(url.pathname)?.[1] ??
      ZOOM_WEB_CLIENT_JOIN_PATH.exec(url.pathname)?.[1];
    if (!meetingNumber) return joinUrl;

    const params = new URLSearchParams({
      action: "join",
      confno: meetingNumber,
    });
    const passcode = url.searchParams.get("pwd");
    if (passcode) params.set("pwd", passcode);

    return `zoommtg://${url.hostname}/join?${params.toString()}`;
  } catch {
    return joinUrl;
  }
}
