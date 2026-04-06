import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  readBody,
  createError,
} from "h3";
import { eq, and, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.js";
import { getSession } from "@agent-native/core/server";
import { getOrgContext } from "../lib/org-context.js";
import type { AgentNote } from "@shared/types";

export const listNotesHandler = defineEventHandler(async (event) => {
  const ctx = await getOrgContext(event);
  const query = getQuery(event) as { candidate_id?: string };
  const candidateId = Number(query.candidate_id);
  if (!candidateId)
    throw createError({
      statusCode: 400,
      message: "candidate_id is required",
    });

  // If user is in an org, show all org notes. Otherwise show only their own.
  const condition = ctx.orgId
    ? and(
        eq(schema.agentNotes.candidateId, candidateId),
        eq(schema.agentNotes.orgId, ctx.orgId),
      )
    : and(
        eq(schema.agentNotes.candidateId, candidateId),
        eq(schema.agentNotes.ownerEmail, ctx.email),
        isNull(schema.agentNotes.orgId),
      );

  const rows = await db.select().from(schema.agentNotes).where(condition);

  return rows.map(
    (r): AgentNote => ({
      id: r.id,
      candidateId: r.candidateId,
      content: r.content,
      type: r.type as AgentNote["type"],
      createdAt: new Date(r.createdAt).toISOString(),
      authorEmail: r.ownerEmail ?? undefined,
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

  const ctx = await getOrgContext(event);
  const id = nanoid();
  const now = Date.now();

  await db.insert(schema.agentNotes).values({
    id,
    candidateId: Number(body.candidateId),
    content: body.content,
    type: body.type,
    createdAt: now,
    ownerEmail: ctx.email !== "local@localhost" ? ctx.email : null,
    orgId: ctx.orgId,
  });

  return {
    id,
    candidateId: body.candidateId,
    content: body.content,
    type: body.type,
    createdAt: new Date(now).toISOString(),
    authorEmail: ctx.email,
  };
});

export const deleteNoteHandler = defineEventHandler(async (event) => {
  const ctx = await getOrgContext(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, message: "Note ID required" });

  // If in an org, any org member can delete notes (org-scoped).
  // If solo, only the author can delete.
  const condition = ctx.orgId
    ? and(eq(schema.agentNotes.id, id), eq(schema.agentNotes.orgId, ctx.orgId))
    : and(
        eq(schema.agentNotes.id, id),
        eq(schema.agentNotes.ownerEmail, ctx.email),
        isNull(schema.agentNotes.orgId),
      );

  await db.delete(schema.agentNotes).where(condition);

  return { success: true };
});
