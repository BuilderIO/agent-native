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
import { and, asc, desc, eq, isNull } from "drizzle-orm";
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
