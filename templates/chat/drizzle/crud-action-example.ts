/**
 * COPY-PASTE REFERENCE — not a live action.
 *
 * Read with `server/db/schema.ts`. Do not move this file into `actions/` as-is;
 * copy the pieces you need into `actions/<name>.ts` after the matching table
 * exists in the schema and has been migrated (`pnpm db:generate` +
 * `pnpm db:migrate`).
 *
 * Assumes a `notes` table exported from `server/db/schema.ts` and
 * `getDb` / `schema` from `server/db/index.ts`.
 *
 * Verification after a batch of CRUD work: one smoke call (e.g. create +
 * list), then one `pnpm typecheck` — not one CLI test per action.
 */

import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

// --- list (GET) -----------------------------------------------------------
export const listNotesExample = defineAction({
  description: "List notes, most recently created first.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    return db
      .select()
      .from(schema.notes)
      .orderBy(desc(schema.notes.createdAt));
  },
});

// --- create (POST, default) -----------------------------------------------
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

// --- update (optional fields patch) --------------------------------------
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
      updatedAt: string;
    } = { updatedAt: new Date().toISOString() };
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

// --- delete ---------------------------------------------------------------
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
