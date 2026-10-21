export type MeetingPlatform = "zoom" | "meet" | "teams" | "webex" | "other";

const PLATFORM_HOSTS: Record<MeetingPlatform, readonly string[]> = {
  zoom: ["zoom.us", "zoom.com", "zoomgov.com"],
  meet: ["meet.google.com"],
  teams: ["teams.microsoft.com", "teams.live.com"],
  webex: ["webex.com", "webex.us"],
  other: [],
};

function isHost(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

export function detectMeetingPlatform(
  joinUrl?: string | null,
): MeetingPlatform {
  if (!joinUrl) return "other";

  let hostname: string;
  try {
    const url = new URL(joinUrl);
    if (url.protocol !== "https:") return "other";
    hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  } catch (error) {
    if (error instanceof TypeError) return "other";
    throw error;
  }

  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS) as Array<
    [MeetingPlatform, readonly string[]]
  >) {
    if (hosts.some((host) => isHost(hostname, host))) return platform;
  }
  return "other";
}

export function extractMeetingJoinUrl(text: string): string | undefined {
  const urls = text.match(/https:\/\/[^\s<>"']+/gi) ?? [];
  for (const url of urls) {
    const candidate = url.replace(/[),.;!?]+$/, "");
    if (detectMeetingPlatform(candidate) !== "other") return candidate;
  }
  return undefined;
}
