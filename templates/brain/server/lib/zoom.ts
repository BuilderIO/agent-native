const ZOOM_API_BASE = "https://api.zoom.us/v2";
const ZOOM_OAUTH_URL = "https://zoom.us/oauth/token";
const ZOOM_REQUEST_TIMEOUT_MS = 30_000;
const ZOOM_PAGE_SIZE = 300;
const ZOOM_MAX_DOWNLOAD_REDIRECTS = 5;

export class ZoomHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`Zoom API request failed with status ${status}.`);
    this.name = "ZoomHttpError";
  }
}

export interface ZoomCredentials {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

export interface ZoomRecordingFile {
  id: string;
  file_type: string;
  status?: string;
  download_url?: string;
}

export interface ZoomMeeting {
  uuid: string;
  id: number | string;
  topic?: string;
  start_time: string;
  share_url?: string;
  recording_files?: ZoomRecordingFile[];
}

interface ZoomUsersPage {
  users?: Array<{ id?: string }>;
  next_page_token?: string;
}

interface ZoomRecordingsPage {
  meetings?: ZoomMeeting[];
  next_page_token?: string;
}

function retryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.ceil(parsed) : null;
}

function assertOk(response: Response) {
  if (!response.ok) {
    throw new ZoomHttpError(
      response.status,
      retryAfterSeconds(response.headers),
    );
  }
}

function isZoomHost(url: URL) {
  return (
    url.protocol === "https:" &&
    (url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us"))
  );
}

async function zoomApiJson<T>(token: string, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(ZOOM_REQUEST_TIMEOUT_MS),
  });
  assertOk(response);
  return (await response.json()) as T;
}

export async function fetchZoomAccessToken(
  credentials: ZoomCredentials,
): Promise<string> {
  const basic = Buffer.from(
    `${credentials.clientId}:${credentials.clientSecret}`,
  ).toString("base64");
  const response = await fetch(
    `${ZOOM_OAUTH_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(credentials.accountId)}`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
      signal: AbortSignal.timeout(ZOOM_REQUEST_TIMEOUT_MS),
    },
  );
  assertOk(response);
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("Zoom OAuth token response did not include access_token.");
  }
  return body.access_token;
}

export async function listZoomUserIds(token: string): Promise<string[]> {
  const ids: string[] = [];
  let nextPageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      status: "active",
      page_size: String(ZOOM_PAGE_SIZE),
    });
    if (nextPageToken) params.set("next_page_token", nextPageToken);
    const page = await zoomApiJson<ZoomUsersPage>(
      token,
      `${ZOOM_API_BASE}/users?${params.toString()}`,
    );
    for (const user of page.users ?? []) {
      if (user.id) ids.push(user.id);
    }
    nextPageToken = page.next_page_token || undefined;
  } while (nextPageToken);
  return ids;
}

export async function listZoomRecordings(
  token: string,
  userId: string,
  from: string,
  to: string,
): Promise<ZoomMeeting[]> {
  const meetings: ZoomMeeting[] = [];
  let nextPageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      from,
      to,
      page_size: String(ZOOM_PAGE_SIZE),
    });
    if (nextPageToken) params.set("next_page_token", nextPageToken);
    const page = await zoomApiJson<ZoomRecordingsPage>(
      token,
      `${ZOOM_API_BASE}/users/${encodeURIComponent(userId)}/recordings?${params.toString()}`,
    );
    meetings.push(...(page.meetings ?? []));
    nextPageToken = page.next_page_token || undefined;
  } while (nextPageToken);
  return meetings;
}

/**
 * Redirects are followed by hand: the bearer token may only ride along to
 * Zoom hosts, so a hop to a CDN or any other origin is fetched without it.
 */
export async function downloadZoomTranscript(
  token: string,
  downloadUrl: string,
): Promise<string> {
  let url = new URL(downloadUrl);
  if (!isZoomHost(url)) {
    throw new Error(
      "Zoom transcript download URL must be an https zoom.us URL.",
    );
  }
  for (let hop = 0; hop <= ZOOM_MAX_DOWNLOAD_REDIRECTS; hop += 1) {
    const response = await fetch(url.toString(), {
      headers: isZoomHost(url) ? { Authorization: `Bearer ${token}` } : {},
      redirect: "manual",
      signal: AbortSignal.timeout(ZOOM_REQUEST_TIMEOUT_MS),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      if (url.protocol !== "https:") {
        throw new Error(
          "Zoom transcript download redirected to a non-https URL.",
        );
      }
      continue;
    }
    assertOk(response);
    return await response.text();
  }
  throw new Error("Zoom transcript download exceeded the redirect limit.");
}

const VTT_TIMING = /^(\d{1,2}:\d{2}:\d{2})(?:[.,]\d+)?\s+-->/;
const VTT_SPEAKER = /^([^:]{1,120}):\s+(.+)$/;

export function parseZoomVtt(vtt: string): string[] {
  const lines: string[] = [];
  let start = "";
  for (const rawLine of vtt.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("WEBVTT") || /^\d+$/.test(line)) continue;
    const timing = VTT_TIMING.exec(line);
    if (timing) {
      start = timing[1].padStart(8, "0");
      continue;
    }
    if (line.includes("-->")) continue;
    const speaker = VTT_SPEAKER.exec(line);
    if (speaker) {
      const label = start ? `${speaker[1].trim()} ${start}` : speaker[1].trim();
      lines.push(`[${label}] ${speaker[2].trim()}`);
    } else {
      lines.push(start ? `[${start}] ${line}` : line);
    }
  }
  return lines;
}

export function normalizeZoomRecording(meeting: ZoomMeeting, vtt: string) {
  const lines = parseZoomVtt(vtt);
  if (lines.length === 0) return null;
  const title = meeting.topic?.trim() || "Zoom meeting";
  return {
    externalId: `zoom:${meeting.uuid}`,
    title,
    capturedAt: meeting.start_time,
    content: `${title}\nDate: ${meeting.start_time}\n\nTranscript\n${lines.join("\n")}`,
    metadata: {
      provider: "zoom",
      connector: "zoom",
      zoomMeetingId: String(meeting.id),
      zoomMeetingUuid: meeting.uuid,
      meetingTopic: title,
      sourceUrl: meeting.share_url ?? null,
    },
  };
}
