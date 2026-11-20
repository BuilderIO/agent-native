import { defineAction } from "@agent-native/core/action";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { FORM_EVENT_TYPES } from "../shared/form-contract.js";
import { firstRow, formsErrors, nowIso } from "./_access.js";
import { findPublicForm } from "./_form-store.js";

const EVENTS_PER_SESSION = 200;
const MAX_DATA_BYTES = 1024;

export default defineAction({
  description:
    "Record a respondent event (visit, start, page view, question view or answer, drop-off) for a published form; no sign-in needed. Over-limit or unavailable calls record nothing.",
  schema: z.object({
    formId: z.string().min(1).max(64).describe("Form id"),
    sessionId: z
      .string()
      .min(8)
      .max(128)
      .describe("Respondent browser session id"),
    type: z.enum(FORM_EVENT_TYPES).describe("Event type"),
    data: z
      .record(z.string().max(64), z.unknown())
      .optional()
      .describe(
        "Small detail such as { page: 2 } or { questionId }, under 1 KB",
      ),
  }),
  outputSchema: z.object({ recorded: z.boolean() }),
  errors: formsErrors,
  requiresAuth: false,
  run: async ({ formId, sessionId, type, data }) => {
    if (data && JSON.stringify(data).length > MAX_DATA_BYTES)
      return { recorded: false };
    const db = getDb();
    const found = await findPublicForm(db, formId);
    if (!found) return { recorded: false };
    const { orgId } = found.form;
    const { formEvents } = schema;
    const count = firstRow(
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(formEvents)
        .where(eq(formEvents.sessionId, sessionId)),
    );
    if ((count?.n ?? 0) >= EVENTS_PER_SESSION) return { recorded: false };
    await db.insert(formEvents).values({
      id: crypto.randomUUID(),
      orgId,
      formId,
      sessionId,
      type,
      data: data ?? null,
      at: nowIso(),
    });
    return { recorded: true };
  },
});
