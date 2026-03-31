import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  readBody,
  createError,
} from "h3";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.js";
import { getSession } from "@agent-native/core/server";
import type { AgentNote } from "@shared/types";

export const listNotesHandler = defineEventHandler(async (event) => {
  const session = await getSession(event);
  const ownerEmail = session?.email ?? "local@localhost";
  const query = getQuery(event) as { candidate_id?: string };
  const candidateId = Number(query.candidate_id);
  if (!candidateId)
    throw createError({
      statusCode: 400,
      message: "candidate_id is required",
    });

  const rows = await db
    .select()
    .from(schema.agentNotes)
    .where(
      and(
        eq(schema.agentNotes.candidateId, candidateId),
        eq(schema.agentNotes.ownerEmail, ownerEmail),
      ),
    );

  return rows.map(
    (r): AgentNote => ({
      id: r.id,
      candidateId: r.candidateId,
      content: r.content,
      type: r.type as AgentNote["type"],
      createdAt: new Date(r.createdAt).toISOString(),
    }),
  );
});

export const createNoteHandler = defineEventHandler(async (event) => {
  const body = await readBody(event);
  if (!body?.candidateId || !body?.content || !body?.type) {
    throw createError({
      statusCode: 400,
      message: "candidateId, content, and type are required",
    });
  }

  const session = await getSession(event);
  const id = nanoid();
  const now = Date.now();

  await db.insert(schema.agentNotes).values({
    id,
    candidateId: Number(body.candidateId),
    content: body.content,
    type: body.type,
    createdAt: now,
    ownerEmail: session?.email ?? null,
  });

  return {
    id,
    candidateId: body.candidateId,
    content: body.content,
    type: body.type,
    createdAt: new Date(now).toISOString(),
  };
});

export const deleteNoteHandler = defineEventHandler(async (event) => {
  const session = await getSession(event);
  const ownerEmail = session?.email ?? "local@localhost";
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, message: "Note ID required" });

  await db
    .delete(schema.agentNotes)
    .where(
      and(
        eq(schema.agentNotes.id, id),
        eq(schema.agentNotes.ownerEmail, ownerEmail),
      ),
    );

  return { success: true };
});
