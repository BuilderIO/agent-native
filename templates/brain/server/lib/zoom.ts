import {
  normalizeZoomMeetingId,
  normalizeZoomMeetingTopic,
} from "../../shared/zoom-meeting-filter.js";
import { sanitizeSensitiveText } from "./sensitivity-policy.js";

const ZOOM_API_BASE = "https://api.zoom.us/v2";
const ZOOM_OAUTH_URL = "https://zoom.us/oauth/token";
const ZOOM_REQUEST_TIMEOUT_MS = 30_000;
const ZOOM_PAGE_SIZE = 300;
const ZOOM_MAX_DOWNLOAD_REDIRECTS = 5;

export class ZoomHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | null,
    readonly step = "API request",
    readonly zoomCode: string | null = null,
    readonly zoomReason: string | null = null,
  ) {
    const code = zoomCode ? " (code " + zoomCode + ")" : "";
    const reason = zoomReason ? ": " + zoomReason : "";
    const hint =
      zoomCode === "unsupported_grant_type"
        ? " These credentials are not from a Zoom Server-to-Server OAuth app. Create one in the Zoom App Marketplace and replace ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET."
        : "";
    super(
      "Zoom " +
        step +
        " failed with status " +
        status +
        code +
        reason +
        "." +
        hint,
    );
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

// Zoom returns {code, message} from the REST API and {error, reason} from
// OAuth. Neither echoes credentials, and the reason is what an admin needs to
// fix scopes or the app type.
async function zoomErrorDetail(
  response: Response,
): Promise<{ code: string | null; reason: string | null }> {
  try {
    const body = await response.text();
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const code = parsed.code ?? parsed.error;
    const reason = parsed.message ?? parsed.reason;
    return {
      code:
        typeof code === "string" || typeof code === "number"
          ? String(code)
          : null,
      reason: typeof reason === "string" ? reason.slice(0, 300) : null,
    };
  } catch {
    return { code: null, reason: null };
  }
}

async function assertOk(response: Response, step: string) {
  if (response.ok) return;
  const detail = await zoomErrorDetail(response);
  throw new ZoomHttpError(
    response.status,
    retryAfterSeconds(response.headers),
    step,
    detail.code,
    detail.reason,
  );
}

function isZoomHost(url: URL) {
  return (
    url.protocol === "https:" &&
    (url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us"))
  );
}

async function zoomApiJson<T>(
  token: string,
  url: string,
  step: string,
): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(ZOOM_REQUEST_TIMEOUT_MS),
  });
  await assertOk(response, step);
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
  await assertOk(response, "token request");
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("Zoom OAuth token response did not include access_token.");
  }
  return body.access_token;
}

type ZoomPageCallback = () => Promise<void>;

// "me" is the token's own account and needs only the :admin scope; a literal
// account ID is a master-account call that requires the :master scope.
export function listZoomAccountRecordings(
  token: string,
  from: string,
  to: string,
  onPage?: ZoomPageCallback,
) {
  return listZoomRecordingPages(
    token,
    "/accounts/me/recordings",
    from,
    to,
    onPage,
  );
}

export function listZoomRecordings(
  token: string,
  userId: string,
  from: string,
  to: string,
  onPage?: ZoomPageCallback,
) {
  const path = "/users/" + encodeURIComponent(userId) + "/recordings";
  return listZoomRecordingPages(token, path, from, to, onPage);
}

async function listZoomRecordingPages(
  token: string,
  path: string,
  from: string,
  to: string,
  onPage?: ZoomPageCallback,
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
      `${ZOOM_API_BASE}${path}?${params.toString()}`,
      "recording list",
    );
    meetings.push(...(page.meetings ?? []));
    await onPage?.();
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
    await assertOk(response, "transcript download");
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
    externalId: zoomExternalId(meeting),
    title,
    capturedAt: meeting.start_time,
    content: `${title}\nDate: ${meeting.start_time}\n\nTranscript\n${lines.join("\n")}`,
    metadata: {
      provider: "zoom",
      connector: "zoom",
      zoomMeetingId: String(meeting.id),
      zoomMeetingUuid: meeting.uuid,
      meetingTopic: sanitizeSensitiveText(title),
      sourceUrl: meeting.share_url ?? null,
    },
  };
}

export function zoomExternalId(meeting: Pick<ZoomMeeting, "uuid">): string {
  return `zoom:${meeting.uuid}`;
}

export function hasProcessingTranscript(meeting: ZoomMeeting): boolean {
  return (meeting.recording_files ?? []).some(
    (file) => file.file_type === "TRANSCRIPT" && file.status === "processing",
  );
}

export interface ZoomMeetingFilter {
  meetingIds: Set<string>;
  meetingTopics: Set<string>;
}

function normalizedSet(
  raw: unknown,
  normalize: (value: unknown) => string | null,
): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(
    raw.map(normalize).filter((value): value is string => Boolean(value)),
  );
}

export function zoomMeetingFilterFromConfig(
  zoomConfig: Record<string, unknown>,
): ZoomMeetingFilter | null {
  const filter = {
    meetingIds: normalizedSet(zoomConfig.meetingIds, normalizeZoomMeetingId),
    meetingTopics: normalizedSet(
      zoomConfig.meetingTopics,
      normalizeZoomMeetingTopic,
    ),
  };
  return filter.meetingIds.size || filter.meetingTopics.size ? filter : null;
}

export function zoomMeetingFilterKey(
  filter: ZoomMeetingFilter | null,
): string | null {
  if (!filter) return null;
  return JSON.stringify({
    meetingIds: [...filter.meetingIds].sort(),
    meetingTopics: [...filter.meetingTopics].sort(),
  });
}

export function zoomMeetingMatchesFilter(
  meeting: Pick<ZoomMeeting, "id" | "topic">,
  filter: ZoomMeetingFilter | null,
): boolean {
  if (!filter) return true;
  const id = normalizeZoomMeetingId(meeting.id);
  if (id && filter.meetingIds.has(id)) return true;
  const topic = normalizeZoomMeetingTopic(meeting.topic);
  return Boolean(topic && filter.meetingTopics.has(topic));
}

// The window must stay open until every pending transcript finishes, or a
// transcript that takes longer than the overlap is never scanned again.
export function nextZoomCursorFrom(input: {
  overlapFrom: string;
  pendingMeetingStarts: string[];
  earliest: string;
}): string {
  const pending = input.pendingMeetingStarts
    .map((start) => start.slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const from = [input.overlapFrom, ...pending].sort()[0]!;
  return from < input.earliest ? input.earliest : from;
}
