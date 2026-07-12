const ZOOM_JOIN_PATH = /^\/j\/(\d+)\/?$/;

function isZoomMeetingHost(hostname: string): boolean {
  return hostname === "zoom.us" || hostname.endsWith(".zoom.us");
}

/**
 * Resolve a calendar join URL to the native desktop-app URI when the provider
 * supports one. Unknown providers and unsupported Zoom URL shapes stay on
 * their original HTTPS URL.
 */
export function resolveDesktopMeetingJoinUrl(joinUrl: string): string {
  try {
    const url = new URL(joinUrl);
    if (url.protocol !== "https:" || !isZoomMeetingHost(url.hostname)) {
      return joinUrl;
    }

    const meetingNumber = ZOOM_JOIN_PATH.exec(url.pathname)?.[1];
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
