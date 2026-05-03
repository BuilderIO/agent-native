/**
 * See what the user is currently looking at on screen.
 *
 * Reads `navigation` application state and fetches the relevant context
 * (recording + transcript + comments if viewing a recording, folder contents
 * if on library, space list if on spaces, etc.). Returns a single JSON
 * snapshot the agent can reason over.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  getActiveOrganizationId,
  parseSpaceIds,
} from "../server/lib/recordings.js";

interface NavigationState {
  view?: string;
  recordingId?: string;
  spaceId?: string;
  folderId?: string;
  shareId?: string;
  search?: string;
  path?: string;
  meetingId?: string;
  dictationId?: string;
}

function mapRecording(r: any) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    thumbnailUrl: r.thumbnailUrl,
    durationMs: r.durationMs,
    status: r.status,
    visibility: r.visibility,
    ownerEmail: r.ownerEmail,
    folderId: r.folderId,
    spaceIds: parseSpaceIds(r.spaceIds),
    hasAudio: Boolean(r.hasAudio),
    hasCamera: Boolean(r.hasCamera),
    defaultSpeed: r.defaultSpeed,
    enableComments: Boolean(r.enableComments),
    enableReactions: Boolean(r.enableReactions),
    enableDownloads: Boolean(r.enableDownloads),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    archivedAt: r.archivedAt,
    trashedAt: r.trashedAt,
  };
}

async function fetchRecording(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, id),
        accessFilter(schema.recordings, schema.recordingShares),
      ),
    );
  return row ? mapRecording(row) : null;
}

async function fetchTranscript(recordingId: string) {
  const db = getDb();
  const [t] = await db
    .select()
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, recordingId));
  if (!t) return null;
  let segments: unknown = [];
  try {
    segments = JSON.parse(t.segmentsJson);
  } catch {
    segments = [];
  }
  return {
    recordingId: t.recordingId,
    language: t.language,
    status: t.status,
    fullText: t.fullText,
    segments,
  };
}

async function fetchComments(recordingId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.recordingComments)
    .where(eq(schema.recordingComments.recordingId, recordingId))
    .orderBy(asc(schema.recordingComments.videoTimestampMs));
  return rows.map((c) => ({
    id: c.id,
    threadId: c.threadId,
    parentId: c.parentId,
    authorEmail: c.authorEmail,
    authorName: c.authorName,
    content: c.content,
    videoTimestampMs: c.videoTimestampMs,
    resolved: Boolean(c.resolved),
    createdAt: c.createdAt,
  }));
}

async function fetchLibrary(folderId?: string) {
  const db = getDb();
  const conditions = [
    accessFilter(schema.recordings, schema.recordingShares),
    isNull(schema.recordings.archivedAt),
    isNull(schema.recordings.trashedAt),
  ];
  if (folderId) {
    conditions.push(eq(schema.recordings.folderId, folderId));
  } else {
    conditions.push(isNull(schema.recordings.folderId));
  }
  const rows = await db
    .select()
    .from(schema.recordings)
    .where(and(...conditions))
    .orderBy(desc(schema.recordings.updatedAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    durationMs: r.durationMs,
    status: r.status,
    thumbnailUrl: r.thumbnailUrl,
    folderId: r.folderId,
    updatedAt: r.updatedAt,
  }));
}

async function fetchFoldersForSpace(spaceId: string | null) {
  const db = getDb();
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) return [];
  const rows = await db
    .select()
    .from(schema.folders)
    .where(
      and(
        eq(schema.folders.ownerEmail, ownerEmail),
        spaceId
          ? eq(schema.folders.spaceId, spaceId)
          : isNull(schema.folders.spaceId),
      ),
    )
    .orderBy(asc(schema.folders.position));
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    spaceId: f.spaceId,
  }));
}

async function fetchSpaces(organizationId: string | null) {
  // No active org -> don't leak cross-tenant spaces. The org switcher in the
  // UI is responsible for prompting the user to choose an organization.
  if (!organizationId) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.spaces)
    .where(eq(schema.spaces.organizationId, organizationId))
    .orderBy(asc(schema.spaces.name));
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    iconEmoji: s.iconEmoji,
    isAllCompany: Boolean(s.isAllCompany),
    organizationId: s.organizationId,
  }));
}

function safeJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function fetchUpcomingMeetings() {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const sevenDaysOut = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = await db
    .select()
    .from(schema.meetings)
    .where(
      and(
        accessFilter(schema.meetings, schema.meetingShares),
        isNull(schema.meetings.trashedAt),
        isNotNull(schema.meetings.scheduledStart),
        gte(schema.meetings.scheduledStart, nowIso),
        lte(schema.meetings.scheduledStart, sevenDaysOut),
      ),
    )
    .orderBy(asc(schema.meetings.scheduledStart))
    .limit(10);
  // Pre-fetch participants for all upcoming meetings so the agent can see
  // attendees without a follow-up call. Cheap: top 10 meetings.
  const ids = rows.map((m) => m.id);
  const participantsByMeeting = new Map<
    string,
    Array<{ email: string; name: string | null }>
  >();
  if (ids.length) {
    for (const id of ids) {
      const ps = await db
        .select({
          email: schema.meetingParticipants.email,
          name: schema.meetingParticipants.name,
        })
        .from(schema.meetingParticipants)
        .where(eq(schema.meetingParticipants.meetingId, id));
      participantsByMeeting.set(id, ps);
    }
  }
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    scheduledStart: m.scheduledStart,
    scheduledEnd: m.scheduledEnd,
    platform: m.platform,
    joinUrl: m.joinUrl,
    transcriptStatus: m.transcriptStatus,
    attendees: participantsByMeeting.get(m.id) ?? [],
  }));
}

async function fetchMeetingDetail(meetingId: string) {
  const db = getDb();
  const [meeting] = await db
    .select()
    .from(schema.meetings)
    .where(
      and(
        eq(schema.meetings.id, meetingId),
        accessFilter(schema.meetings, schema.meetingShares),
      ),
    )
    .limit(1);
  if (!meeting) return null;

  const participants = await db
    .select()
    .from(schema.meetingParticipants)
    .where(eq(schema.meetingParticipants.meetingId, meetingId));

  const actionItems = await db
    .select()
    .from(schema.meetingActionItems)
    .where(eq(schema.meetingActionItems.meetingId, meetingId));

  let recording: { id: string; title: string } | null = null;
  let transcriptSnippet: string | null = null;
  if (meeting.recordingId) {
    const [rec] = await db
      .select({
        id: schema.recordings.id,
        title: schema.recordings.title,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, meeting.recordingId))
      .limit(1);
    recording = rec ?? null;
    const [tr] = await db
      .select({ fullText: schema.recordingTranscripts.fullText })
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, meeting.recordingId))
      .limit(1);
    if (tr?.fullText) {
      transcriptSnippet = tr.fullText.slice(0, 2000);
    }
  }

  return {
    meeting: {
      id: meeting.id,
      title: meeting.title,
      scheduledStart: meeting.scheduledStart,
      scheduledEnd: meeting.scheduledEnd,
      actualStart: meeting.actualStart,
      actualEnd: meeting.actualEnd,
      platform: meeting.platform,
      joinUrl: meeting.joinUrl,
      source: meeting.source,
      userNotesMd: meeting.userNotesMd,
      transcriptStatus: meeting.transcriptStatus,
      summaryMd: meeting.summaryMd,
      bullets: safeJsonArray<{ text: string }>(meeting.bulletsJson),
    },
    participants: participants.map((p) => ({
      email: p.email,
      name: p.name,
      isOrganizer: Boolean(p.isOrganizer),
      attendedAt: p.attendedAt,
    })),
    actionItems: actionItems.map((a) => ({
      id: a.id,
      assigneeEmail: a.assigneeEmail,
      text: a.text,
      dueDate: a.dueDate,
      completedAt: a.completedAt,
    })),
    recording,
    transcriptSnippet,
  };
}

async function fetchRecentDictations() {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.dictations)
    .where(accessFilter(schema.dictations, schema.dictationShares))
    .orderBy(desc(schema.dictations.startedAt))
    .limit(10);
  return rows.map((d) => ({
    id: d.id,
    startedAt: d.startedAt,
    durationMs: d.durationMs,
    source: d.source,
    targetApp: d.targetApp,
    // First 200 chars only — the list view doesn't need the full body.
    preview: (d.fullText ?? "").slice(0, 200),
    hasCleanedText: Boolean(d.cleanedText),
  }));
}

async function fetchDictationDetail(dictationId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dictations)
    .where(
      and(
        eq(schema.dictations.id, dictationId),
        accessFilter(schema.dictations, schema.dictationShares),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    startedAt: row.startedAt,
    durationMs: row.durationMs,
    source: row.source,
    targetApp: row.targetApp,
    fullText: row.fullText,
    cleanedText: row.cleanedText,
  };
}

async function fetchShare(shareId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.recordingShares)
    .where(eq(schema.recordingShares.id, shareId));
  return row ?? null;
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current navigation state plus relevant context (recording + transcript + comments on a recording page, folder contents on library, space list on spaces, etc.). Prefer reading the auto-included <current-screen> block — call this only when you need a refreshed snapshot.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = (await readAppState(
      "navigation",
    )) as NavigationState | null;
    const playerState = await readAppState("player-state");
    const editorDraft = await readAppState("editor-draft");
    const selection = await readAppState("selection");
    const organizationId = await getActiveOrganizationId();
    const recordIntent = await readAppState("record-intent");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (organizationId) screen.organizationId = organizationId;
    if (playerState) screen.playerState = playerState;
    if (editorDraft) screen.editorDraft = editorDraft;
    if (selection) screen.selection = selection;
    if (recordIntent) screen.recordIntent = recordIntent;

    const nav = navigation ?? {};

    switch (nav.view) {
      case "recording":
      case "insights": {
        if (nav.recordingId) {
          const recording = await fetchRecording(nav.recordingId);
          if (recording) {
            const [transcript, comments] = await Promise.all([
              fetchTranscript(nav.recordingId),
              fetchComments(nav.recordingId),
            ]);
            screen.recording = recording;
            if (transcript) screen.transcript = transcript;
            screen.comments = comments;
          }
        }
        break;
      }
      case "library": {
        const [recordings, folders] = await Promise.all([
          fetchLibrary(nav.folderId),
          fetchFoldersForSpace(null),
        ]);
        screen.library = {
          folderId: nav.folderId ?? null,
          search: nav.search ?? null,
          count: recordings.length,
          recordings,
          folders,
        };
        break;
      }
      case "spaces": {
        screen.spaces = await fetchSpaces(organizationId);
        break;
      }
      case "space": {
        if (nav.spaceId) {
          const [folders, spaces] = await Promise.all([
            fetchFoldersForSpace(nav.spaceId),
            fetchSpaces(organizationId),
          ]);
          const space = spaces.find((s) => s.id === nav.spaceId) ?? null;
          screen.space = { space, folders };
        }
        break;
      }
      case "share":
      case "embed": {
        if (nav.shareId) {
          const share = await fetchShare(nav.shareId);
          if (share) screen.share = share;
        }
        break;
      }
      case "meetings": {
        screen.meetings = await fetchUpcomingMeetings();
        break;
      }
      case "meeting": {
        if (nav.meetingId) {
          const detail = await fetchMeetingDetail(nav.meetingId);
          if (detail) screen.meeting = detail;
        }
        break;
      }
      case "dictate": {
        if (nav.dictationId) {
          const detail = await fetchDictationDetail(nav.dictationId);
          if (detail) screen.dictation = detail;
        } else {
          screen.dictations = await fetchRecentDictations();
        }
        break;
      }
      case "archive":
      case "trash":
      case "record":
      case "notifications":
      case "settings":
      default:
        break;
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
