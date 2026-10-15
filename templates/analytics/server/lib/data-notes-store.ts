import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { and, count, desc, eq, sql } from "drizzle-orm";

import {
  DATA_NOTE_KINDS,
  DATA_NOTE_STATUSES,
  type DataNote,
  type DataNoteKind,
  type DataNotePanelRef,
  type DataNoteStatus,
} from "../../shared/data-notes.js";
import { getDb, schema } from "../db/index.js";
import {
  inAnnotationScope,
  requireAnnotationScope,
  type AnnotationScope,
} from "./annotation-scope.js";

export const MAX_DATA_NOTES = 200;
const MAX_TITLE_LENGTH = 120;
const MAX_NOTE_LENGTH = 1000;
const MAX_FIX_LENGTH = 500;
const MAX_EVENTS = 20;
const MAX_EVENT_LENGTH = 200;
const MAX_PANELS = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const notes = schema.analyticsDataNotes;
type NoteRow = typeof notes.$inferSelect;

export const requireDataNoteScope = requireAnnotationScope;

function parseList<T>(row: NoteRow, column: string, text: string): T[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) {
    throw new Error(`Data note ${row.id} has a malformed ${column} column.`);
  }
  return value as T[];
}

function toDataNote(row: NoteRow): DataNote {
  return {
    id: row.id,
    kind: row.kind as DataNoteKind,
    title: row.title,
    note: row.note,
    ...(row.startDate ? { startDate: row.startDate } : {}),
    ...(row.endDate ? { endDate: row.endDate } : {}),
    status: row.status as DataNoteStatus,
    ...(row.fix ? { fix: row.fix } : {}),
    matchEvents: parseList<string>(row, "match_events", row.matchEvents),
    unlessEvents: parseList<string>(row, "unless_events", row.unlessEvents),
    panels: parseList<DataNotePanelRef>(row, "panels", row.panels),
    addedBy: row.ownerEmail,
    updatedAt: row.updatedAt,
  };
}

/** Newest first: by start, and notes with no known start by their end. */
export async function listDataNotes(
  scope: AnnotationScope,
): Promise<DataNote[]> {
  const rows: NoteRow[] = await (getDb() as any)
    .select()
    .from(notes)
    .where(inAnnotationScope(notes, scope))
    .orderBy(
      desc(sql`coalesce(${notes.startDate}, ${notes.endDate}, '')`),
      desc(notes.updatedAt),
    )
    .limit(MAX_DATA_NOTES);
  return rows.map(toDataNote);
}

export type SaveDataNoteInput = {
  id?: string;
  kind?: DataNoteKind;
  title?: string;
  note?: string;
  /** null clears it. */
  startDate?: string | null;
  /** null clears it: the problem is ongoing. */
  endDate?: string | null;
  status?: DataNoteStatus;
  /** null clears it. */
  fix?: string | null;
  matchEvents?: string[];
  unlessEvents?: string[];
  panels?: DataNotePanelRef[];
};

type NoteFields = Omit<DataNote, "id" | "addedBy" | "updatedAt">;

function invalid(message: string): never {
  return fail(message, { errorCode: "invalid_data_note", statusCode: 400 });
}

function cleanText(
  value: string | undefined,
  field: string,
  max: number,
): string {
  const text = value?.trim() ?? "";
  if (!text || text.length > max) {
    invalid(`A data note needs ${field} of 1 to ${max} characters.`);
  }
  return text;
}

function cleanDate(value: string | null | undefined, field: string) {
  if (value == null || value === "") return undefined;
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    invalid(`${field} must be a date "YYYY-MM-DD".`);
  }
  return value;
}

function cleanEvents(value: readonly string[], field: string): string[] {
  const events = [
    ...new Set(value.map((event) => event.trim()).filter(Boolean)),
  ];
  if (
    events.length > MAX_EVENTS ||
    events.some((event) => event.length > MAX_EVENT_LENGTH)
  ) {
    invalid(
      `${field} takes up to ${MAX_EVENTS} event names of up to ${MAX_EVENT_LENGTH} characters.`,
    );
  }
  return events;
}

function cleanPanels(value: readonly DataNotePanelRef[]): DataNotePanelRef[] {
  const seen = new Set<string>();
  const panels: DataNotePanelRef[] = [];
  for (const ref of value) {
    const dashboardId = ref.dashboardId?.trim();
    const panelId = ref.panelId?.trim();
    if (!dashboardId || !panelId) {
      invalid("Each entry in panels needs a dashboardId and a panelId.");
    }
    const key = `${dashboardId}\u0000${panelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    panels.push({ dashboardId, panelId });
  }
  if (panels.length > MAX_PANELS) {
    invalid(`A data note can pin up to ${MAX_PANELS} charts.`);
  }
  return panels;
}

function cleanNote(input: SaveDataNoteInput, base?: DataNote): NoteFields {
  const pick = <K extends keyof SaveDataNoteInput & keyof DataNote>(key: K) =>
    input[key] !== undefined ? input[key] : base?.[key];
  const kind = pick("kind");
  if (!kind || !DATA_NOTE_KINDS.includes(kind as DataNoteKind)) {
    invalid(`kind must be one of: ${DATA_NOTE_KINDS.join(", ")}.`);
  }
  const status = pick("status") ?? "open";
  if (!DATA_NOTE_STATUSES.includes(status as DataNoteStatus)) {
    invalid(`status must be one of: ${DATA_NOTE_STATUSES.join(", ")}.`);
  }
  const startDate = cleanDate(pick("startDate"), "startDate");
  const endDate = cleanDate(pick("endDate"), "endDate");
  if (startDate && endDate && startDate > endDate) {
    invalid("startDate must be on or before endDate.");
  }
  if (status === "fixed" && !endDate) {
    invalid("A fixed data note needs the endDate the problem stopped.");
  }
  const fixText = pick("fix")?.trim();
  if (fixText && fixText.length > MAX_FIX_LENGTH) {
    invalid(`fix takes up to ${MAX_FIX_LENGTH} characters.`);
  }
  const matchEvents = cleanEvents(pick("matchEvents") ?? [], "matchEvents");
  const unlessEvents = cleanEvents(pick("unlessEvents") ?? [], "unlessEvents");
  const panels = cleanPanels(pick("panels") ?? []);
  if (matchEvents.length === 0 && panels.length === 0) {
    invalid(
      "A data note needs matchEvents or panels, or it shows on no chart.",
    );
  }
  return {
    kind: kind as DataNoteKind,
    title: cleanText(pick("title"), "a title", MAX_TITLE_LENGTH),
    note: cleanText(pick("note"), "note text", MAX_NOTE_LENGTH),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    status: status as DataNoteStatus,
    ...(fixText ? { fix: fixText } : {}),
    matchEvents,
    unlessEvents,
    panels,
  };
}

function toColumns(fields: NoteFields) {
  return {
    kind: fields.kind,
    title: fields.title,
    note: fields.note,
    startDate: fields.startDate ?? null,
    endDate: fields.endDate ?? null,
    status: fields.status,
    fix: fields.fix ?? null,
    matchEvents: JSON.stringify(fields.matchEvents),
    unlessEvents: JSON.stringify(fields.unlessEvents),
    panels: JSON.stringify(fields.panels),
    updatedAt: new Date().toISOString(),
  };
}

async function findNote(
  scope: AnnotationScope,
  id: string,
): Promise<NoteRow | undefined> {
  const [row] = await (getDb() as any)
    .select()
    .from(notes)
    .where(and(inAnnotationScope(notes, scope), eq(notes.id, id)))
    .limit(1);
  return row;
}

/** Adds a note, or changes only the fields given on the note with `id`. */
export async function saveDataNote(
  scope: AnnotationScope,
  input: SaveDataNoteInput,
): Promise<DataNote> {
  const db = getDb() as any;
  if (input.id) {
    const existing = await findNote(scope, input.id);
    if (!existing) notFound(input.id);
    const [row] = await db
      .update(notes)
      .set(toColumns(cleanNote(input, toDataNote(existing))))
      .where(and(inAnnotationScope(notes, scope), eq(notes.id, input.id)))
      .returning();
    if (!row) notFound(input.id);
    return toDataNote(row);
  }
  const fields = cleanNote(input);
  const [{ total }] = await db
    .select({ total: count() })
    .from(notes)
    .where(inAnnotationScope(notes, scope));
  if (Number(total) >= MAX_DATA_NOTES) {
    fail(`Data notes are limited to ${MAX_DATA_NOTES}.`, {
      errorCode: "data_note_limit",
      statusCode: 409,
    });
  }
  const columns = toColumns(fields);
  const [row] = await db
    .insert(notes)
    .values({
      ...columns,
      id: randomUUID(),
      orgId: scope.orgId,
      ownerEmail: scope.email,
      createdAt: columns.updatedAt,
    })
    .returning();
  return toDataNote(row);
}

export async function deleteDataNote(
  scope: AnnotationScope,
  id: string,
): Promise<{ id: string }> {
  const deleted = await (getDb() as any)
    .delete(notes)
    .where(and(inAnnotationScope(notes, scope), eq(notes.id, id)))
    .returning({ id: notes.id });
  if (deleted.length === 0) notFound(id);
  return { id };
}

function notFound(id: string): never {
  return fail(`Data note ${id} was not found.`, {
    errorCode: "not_found",
    statusCode: 404,
  });
}
