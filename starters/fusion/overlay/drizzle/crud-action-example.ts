// @ts-nocheck
/**
 * COPY-PASTE REFERENCE — not a live action.
 *
 * Read with `drizzle/START_HERE.md`. Do not move this file into `actions/` as-is;
 * copy the pieces you need into `actions/<name>.ts` after the matching table
 * exists in `drizzle/schema.ts` and has been migrated (`pnpm db:generate`, then
 * `pnpm db:migrate`).
 *
 * ONE ACTION PER FILE, DEFAULT-EXPORTED. The four `export const ...Example`
 * blocks below are a catalog crammed into one file only so this reference stays
 * a single doc. Each becomes its OWN file whose default export IS the action,
 * and the kebab-case filename IS the action name. Do NOT copy them into one file
 * as named exports — only the default export of a file is registered, so the
 * extras never become actions and the file won't match `.generated/action-types.d.ts`.
 *   listNotesExample   -> actions/list-notes.ts   (export default defineAction(...))
 *   createNoteExample  -> actions/create-note.ts
 *   updateNoteExample  -> actions/update-note.ts
 *   deleteNoteExample  -> actions/delete-note.ts
 *
 * Assumes a `notes` table exported from `drizzle/schema.ts` and
 * `getDb` / `schema` from `server/db.ts` (this starter's layout).
 *
 * Verification after a batch of CRUD work: one smoke call (e.g. create +
 * list), then one `pnpm typecheck` — not one CLI test per action.
 */

import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";

export const listNotesExample = defineAction({
  description: "List notes, most recently created first.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    return db.select().from(schema.notes).orderBy(desc(schema.notes.createdAt));
  },
});

export const createNoteExample = defineAction({
  description: "Create a note.",
  schema: z.object({
    title: z.string().min(1).describe("Note title"),
    body: z.string().optional().describe("Optional note body"),
  }),
  run: async ({ title, body }) => {
    const db = getDb();
    const id = crypto.randomUUID();
    const [row] = await db
      .insert(schema.notes)
      .values({
        id,
        title: title.trim(),
        body: body?.trim() ?? "",
      })
      .returning();
    return row;
  },
});

export const updateNoteExample = defineAction({
  description: "Update a note's title, body, and/or archived flag.",
  schema: z.object({
    id: z.string().describe("Note id"),
    title: z.string().min(1).optional().describe("New title"),
    body: z.string().optional().describe("New body"),
    archived: z.boolean().optional().describe("Archived flag"),
  }),
  run: async ({ id, title, body, archived }) => {
    const db = getDb();
    const patch: {
      title?: string;
      body?: string;
      archived?: boolean;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (title !== undefined) patch.title = title.trim();
    if (body !== undefined) patch.body = body;
    if (archived !== undefined) patch.archived = archived;

    const [row] = await db
      .update(schema.notes)
      .set(patch)
      .where(eq(schema.notes.id, id))
      .returning();
    return row ?? null;
  },
});

export const deleteNoteExample = defineAction({
  description: "Delete a note by id.",
  schema: z.object({
    id: z.string().describe("Note id"),
  }),
  http: { method: "DELETE" },
  run: async ({ id }) => {
    const db = getDb();
    const [row] = await db
      .delete(schema.notes)
      .where(eq(schema.notes.id, id))
      .returning();
    return row ?? null;
  },
});
