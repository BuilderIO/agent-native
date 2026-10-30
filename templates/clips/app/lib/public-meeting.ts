import { appApiPath } from "@agent-native/core/client/api-path";

import type { TranscriptSegment } from "@/components/meetings/transcript-bubbles";

import { CLIPS_MEETING_AGENT_ACCESS_PARAM } from "../../shared/meeting-agent-access";

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
  ownerEmail: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  transcriptStatus: string | null;
  transcript: PublicMeetingTranscript | null;
}

export interface PublicMeetingPayload {
  meeting: PublicMeeting;
  viewer: {
    role: "owner" | "admin" | "editor" | "commenter" | "viewer";
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
  agentAccessToken?: string,
): string {
  return meetingRequestUrl(
    `${basePath}/api/public-meeting`,
    origin,
    meetingId,
    agentAccessToken,
  );
}

function meetingRequestUrl(
  path: string,
  origin: string,
  meetingId: string,
  agentAccessToken?: string,
): string {
  const url = new URL(path, origin);
  url.searchParams.set("id", meetingId);
  if (agentAccessToken) {
    url.searchParams.set(CLIPS_MEETING_AGENT_ACCESS_PARAM, agentAccessToken);
  }
  return url.toString();
}

export async function fetchPublicMeeting(
  meetingId: string,
  options: {
    signal?: AbortSignal;
    origin?: string;
    basePath?: string;
    agentAccessToken?: string;
  } = {},
): Promise<PublicMeetingResult> {
  const path =
    options.basePath === undefined
      ? appApiPath("/api/public-meeting")
      : `${options.basePath}/api/public-meeting`;
  const response = await fetch(
    meetingRequestUrl(
      path,
      options.origin ?? window.location.origin,
      meetingId,
      options.agentAccessToken,
    ),
    { signal: options.signal },
  );
  const data = (await response.json().catch(() => ({}))) as
    | PublicMeetingPayload
    | { error?: string };
  return { ok: response.ok, status: response.status, data };
}
