/**
 * Concise snapshot of navigation + player-state + transcript-selection +
 * current-workspace, plus basic details about the currently-viewed call when
 * the agent is on a call page.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

interface NavigationState {
  view?: string;
  callId?: string;
  snippetId?: string;
  folderId?: string;
  spaceId?: string;
  shareId?: string;
  search?: string;
  path?: string;
}

async function fetchCall(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.calls)
    .where(
      and(
        eq(schema.calls.id, id),
        accessFilter(schema.calls, schema.callShares),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    description: row.description,
    status: row.status,
    durationMs: row.durationMs,
    mediaKind: row.mediaKind,
    mediaFormat: row.mediaFormat,
    thumbnailUrl: row.thumbnailUrl,
    recordedAt: row.recordedAt,
    folderId: row.folderId,
    spaceIds: parseSpaceIds(row.spaceIds),
    visibility: row.visibility,
    ownerEmail: row.ownerEmail,
    accountId: row.accountId,
    dealStage: row.dealStage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    trashedAt: row.trashedAt,
  };
}

async function fetchSnippet(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.snippets)
    .where(
      and(
        eq(schema.snippets.id, id),
        accessFilter(schema.snippets, schema.snippetShares),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    callId: row.callId,
    title: row.title,
    description: row.description,
    startMs: row.startMs,
    endMs: row.endMs,
    visibility: row.visibility,
    ownerEmail: row.ownerEmail,
    createdAt: row.createdAt,
  };
}

async function fetchLibrary(folderId?: string) {
  const db = getDb();
  const conditions = [
    accessFilter(schema.calls, schema.callShares),
    isNull(schema.calls.archivedAt),
    isNull(schema.calls.trashedAt),
  ];
  if (folderId) {
    conditions.push(eq(schema.calls.folderId, folderId));
  } else {
    conditions.push(isNull(schema.calls.folderId));
  }
  const rows = await db
    .select()
    .from(schema.calls)
    .where(and(...conditions))
    .orderBy(desc(schema.calls.updatedAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    durationMs: r.durationMs,
    status: r.status,
    thumbnailUrl: r.thumbnailUrl,
    folderId: r.folderId,
    recordedAt: r.recordedAt,
    updatedAt: r.updatedAt,
  }));
}

export default defineAction({
  description:
    "See what the user is currently looking at. Returns navigation, player-state, transcript-selection, current-workspace, and basic call details when on a call page. Prefer reading the auto-included <current-screen> block — call this only when you need a refreshed snapshot.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = (await readAppState(
      "navigation",
    )) as NavigationState | null;
    const playerState = await readAppState("player-state");
    const transcriptSelection = await readAppState("transcript-selection");
    const currentWorkspace = (await readAppState("current-workspace")) as {
      id?: string;
    } | null;

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (currentWorkspace) screen.currentWorkspace = currentWorkspace;
    if (playerState) screen.playerState = playerState;
    if (transcriptSelection) screen.transcriptSelection = transcriptSelection;

    const nav = navigation ?? {};
    switch (nav.view) {
      case "call": {
        if (nav.callId) {
          const call = await fetchCall(nav.callId);
          if (call) screen.call = call;
        }
        break;
      }
      case "snippet": {
        if (nav.snippetId) {
          const snippet = await fetchSnippet(nav.snippetId);
          if (snippet) {
            screen.snippet = snippet;
            const parent = await fetchCall(snippet.callId);
            if (parent) screen.call = parent;
          }
        }
        break;
      }
      case "library": {
        const calls = await fetchLibrary(nav.folderId);
        screen.library = {
          folderId: nav.folderId ?? null,
          search: nav.search ?? null,
          count: calls.length,
          calls,
        };
        break;
      }
      case "search":
      case "trackers":
      case "upload":
      case "archive":
      case "trash":
      case "settings":
      case "notifications":
      case "share":
      case "embed":
      case "invite":
      default:
        break;
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});

void getCurrentOwnerEmail;
void nanoid;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void writeAppState;
void assertAccess;
