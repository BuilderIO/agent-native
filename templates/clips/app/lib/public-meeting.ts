import { appBasePath } from "@agent-native/core/client/api-path";

import type { TranscriptSegment } from "@/components/meetings/transcript-bubbles";

export interface PublicMeetingBullet {
  text: string;
}

export interface PublicMeetingParticipant {
  email: string;
  name: string | null;
  isOrganizer: boolean;
}

export interface PublicMeetingActionItem {
  id: string;
  text: string;
  assigneeEmail: string | null;
  completedAt: string | null;
}

export interface PublicMeetingTranscript {
  status: string;
  language: string | null;
  fullText: string | null;
  segments: TranscriptSegment[];
}

export interface PublicMeeting {
  id: string;
  title: string;
  scheduledStart: string | null;
  summaryMd: string;
  bullets: PublicMeetingBullet[];
  participants: PublicMeetingParticipant[];
  actionItems: PublicMeetingActionItem[];
  actualStart: string | null;
  actualEnd: string | null;
  transcriptStatus: string | null;
  transcript?: PublicMeetingTranscript | null;
}

export interface PublicMeetingPayload {
  meeting: PublicMeeting;
  viewer: {
    role: "owner" | "admin" | "editor" | "viewer";
    canEdit: boolean;
    isOwner: boolean;
  } | null;
}

export interface PublicMeetingResult {
  ok: boolean;
  status: number;
  data: PublicMeetingPayload | { error?: string };
}

export function publicMeetingUrl(
  meetingId: string,
  origin: string,
  basePath: string,
): string {
  const url = new URL(`${basePath}/api/public-meeting`, origin);
  url.searchParams.set("id", meetingId);
  return url.toString();
}

export async function fetchPublicMeeting(
  meetingId: string,
  options: {
    signal?: AbortSignal;
    origin?: string;
    basePath?: string;
  } = {},
): Promise<PublicMeetingResult> {
  const origin = options.origin ?? window.location.origin;
  const basePath = options.basePath ?? appBasePath();
  const response = await fetch(publicMeetingUrl(meetingId, origin, basePath), {
    signal: options.signal,
  });
  const data = (await response.json().catch(() => ({}))) as
    | PublicMeetingPayload
    | { error?: string };
  return { ok: response.ok, status: response.status, data };
}
