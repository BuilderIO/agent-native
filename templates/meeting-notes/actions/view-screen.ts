/**
 * See what the user is currently looking at on screen.
 *
 * Reads `navigation` application state and fetches the relevant context
 * (meeting + transcript + notes if viewing a meeting, folder contents if on
 * the meetings list, etc.). Returns a single JSON snapshot the agent can
 * reason over.
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
import { getActiveOrganizationId } from "../server/lib/meetings.js";

interface NavigationState {
  view?: string;
  meetingId?: string;
  folderId?: string;
  search?: string;
  path?: string;
}

async function fetchMeeting(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.meetings)
    .where(
      and(
        eq(schema.meetings.id, id),
        accessFilter(schema.meetings, schema.meetingShares),
      ),
    );
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status,
    folderId: row.folderId,
    calendarProvider: row.calendarProvider,
    ownerEmail: row.ownerEmail,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function fetchTranscript(meetingId: string) {
  const db = getDb();
  const [t] = await db
    .select()
    .from(schema.meetingTranscripts)
    .where(eq(schema.meetingTranscripts.meetingId, meetingId));
  if (!t) return null;
  let segments: unknown = [];
  try {
    segments = JSON.parse(t.segmentsJson);
  } catch {
    segments = [];
  }
  return {
    id: t.id,
    status: t.status,
    fullText: t.fullText,
    segments,
  };
}

async function fetchNotes(meetingId: string) {
  const db = getDb();
  const [n] = await db
    .select()
    .from(schema.meetingNotes)
    .where(eq(schema.meetingNotes.meetingId, meetingId));
  if (!n) return null;
  return {
    id: n.id,
    rawContent: n.rawContent,
    enhancedContent: n.enhancedContent,
    templateId: n.templateId,
  };
}

async function fetchAttendees(meetingId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.meetingAttendees)
    .where(eq(schema.meetingAttendees.meetingId, meetingId));
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    role: a.role,
  }));
}

async function fetchMeetingsList(folderId?: string) {
  const db = getDb();
  const conditions = [accessFilter(schema.meetings, schema.meetingShares)];
  if (folderId) {
    conditions.push(eq(schema.meetings.folderId, folderId));
  } else {
    conditions.push(isNull(schema.meetings.folderId));
  }
  const rows = await db
    .select()
    .from(schema.meetings)
    .where(and(...conditions))
    .orderBy(desc(schema.meetings.updatedAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startTime: r.startTime,
    status: r.status,
    updatedAt: r.updatedAt,
  }));
}

async function fetchFolders(orgId: string | null) {
  // Folders are an org-scoped roster (no per-row owner). Without an active
  // org, there are no folders the caller can legitimately see -- returning
  // everything would expose other tenants' folder hierarchy.
  if (!orgId) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.meetingFolders)
    .where(eq(schema.meetingFolders.organizationId, orgId))
    .orderBy(asc(schema.meetingFolders.name));
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
  }));
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current navigation state plus relevant context (meeting + transcript + notes on a meeting page, meeting list on the main view, etc.). Prefer reading the auto-included <current-screen> block -- call this only when you need a refreshed snapshot.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = (await readAppState(
      "navigation",
    )) as NavigationState | null;
    const selection = await readAppState("selection");
    const organizationId = await getActiveOrganizationId();

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (organizationId) screen.organizationId = organizationId;
    if (selection) screen.selection = selection;

    const nav = navigation ?? {};

    switch (nav.view) {
      case "meeting": {
        if (nav.meetingId) {
          const [meeting, transcript, notes, attendees] = await Promise.all([
            fetchMeeting(nav.meetingId),
            fetchTranscript(nav.meetingId),
            fetchNotes(nav.meetingId),
            fetchAttendees(nav.meetingId),
          ]);
          if (meeting) screen.meeting = meeting;
          if (transcript) screen.transcript = transcript;
          if (notes) screen.notes = notes;
          screen.attendees = attendees;
        }
        break;
      }
      case "meetings":
      case "library": {
        const [meetings, folders] = await Promise.all([
          fetchMeetingsList(nav.folderId),
          fetchFolders(organizationId),
        ]);
        screen.meetings = {
          folderId: nav.folderId ?? null,
          search: nav.search ?? null,
          count: meetings.length,
          meetings,
          folders,
        };
        break;
      }
      case "people":
      case "companies":
      case "templates":
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
