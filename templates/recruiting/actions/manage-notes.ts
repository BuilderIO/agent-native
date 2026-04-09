import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../server/db/index.js";
import type { AgentNote } from "@shared/types";

function getContext() {
  const email = process.env.AGENT_USER_EMAIL || "local@localhost";
  const orgId = process.env.AGENT_ORG_ID || null;
  return { email, orgId };
}

async function listNotes(candidateId: number) {
  const ctx = getContext();
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
}

async function createNote(candidateId: number, content: string, type: string) {
  const ctx = getContext();
  const id = nanoid();
  const now = Date.now();

  await db.insert(schema.agentNotes).values({
    id,
    candidateId,
    content,
    type,
    createdAt: now,
    ownerEmail: ctx.email !== "local@localhost" ? ctx.email : null,
    orgId: ctx.orgId,
  });

  return {
    id,
    candidateId,
    content,
    type,
    createdAt: new Date(now).toISOString(),
    authorEmail: ctx.email,
  };
}

async function deleteNote(id: string) {
  const ctx = getContext();
  const condition = ctx.orgId
    ? and(eq(schema.agentNotes.id, id), eq(schema.agentNotes.orgId, ctx.orgId))
    : and(
        eq(schema.agentNotes.id, id),
        eq(schema.agentNotes.ownerEmail, ctx.email),
        isNull(schema.agentNotes.orgId),
      );

  await db.delete(schema.agentNotes).where(condition);
  return { success: true };
}

export default defineAction({
  description:
    "Create, list, or delete AI notes on candidates. Use this to save analysis results.",
  schema: z.object({
    action: z
      .enum(["create", "list", "delete"])
      .optional()
      .describe("Action to perform"),
    candidateId: z.coerce.number().optional().describe("Candidate ID"),
    content: z.string().optional().describe("Note content (for create)"),
    type: z
      .enum(["resume_analysis", "comparison", "interview_prep", "general"])
      .optional()
      .describe("Note type (for create)"),
    id: z.string().optional().describe("Note ID (for delete)"),
  }),
  run: async (args) => {
    switch (args.action) {
      case "create": {
        if (!args.candidateId || !args.content || !args.type) {
          throw new Error(
            "--candidateId, --content, and --type are required for create",
          );
        }
        return createNote(args.candidateId, args.content, args.type);
      }
      case "list": {
        if (!args.candidateId) {
          throw new Error("--candidateId is required for list");
        }
        return listNotes(args.candidateId);
      }
      case "delete": {
        if (!args.id) {
          throw new Error("--id is required for delete");
        }
        return deleteNote(args.id);
      }
      default:
        throw new Error("--action must be create, list, or delete");
    }
  },
});
