import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, newId, nowIso, ready , defined } from "../server/core.js";

export default defineAction({
  description: "Create an email asset (omit id) or update one (pass id). body is a JSON array of blocks like {type:'heading'|'text'|'button', text, url?}. Tokens use {{token_name}}.",
  schema: z.object({
    id: z.string().optional().describe("Email id to update; omit to create"),
    name: z.string().min(1).max(200).optional().describe("Internal name"),
    subject: z.string().max(300).optional().describe("Subject line"),
    preheader: z.string().max(300).optional().describe("Preview text"),
    fromName: z.string().max(200).optional().describe("Sender name"),
    fromEmail: z.string().max(200).optional().describe("From address"),
    replyTo: z.string().max(200).optional().describe("Reply-to address"),
    body: z.string().optional().describe("JSON array of content blocks"),
    kind: z.enum(["marketing", "internal", "transactional"]).optional().describe("Email kind"),
    status: z.enum(["draft", "published"]).optional().describe("Draft or published"),
    trackOpens: z.boolean().optional().describe("Track opens"),
    trackClicks: z.boolean().optional().describe("Track clicks"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors,
  run: async ({ id, trackOpens, trackClicks, ...fields }) => {
    await ready();
    const patch = { ...defined(fields), ...(trackOpens !== undefined && { trackOpens: trackOpens ? 1 : 0 }), ...(trackClicks !== undefined && { trackClicks: trackClicks ? 1 : 0 }) };
    const now = nowIso();
    if (!id) {
      const newEmailId = newId("em");
      await getDb().insert(schema.emails).values({
        name: "Untitled email", fromName: "The Journeys Team", fromEmail: "hello@mail.example.com",
        body: JSON.stringify([{ type: "heading", text: "Hello {{first_name}}" }, { type: "text", text: "Write your message here." }]),
        ...patch, id: newEmailId, createdAt: now, updatedAt: now,
      });
      return { id: newEmailId };
    }
    const rows = await getDb().update(schema.emails).set({ ...patch, updatedAt: now }).where(eq(schema.emails.id, id)).returning({ id: schema.emails.id });
    if (rows.length === 0) return errors.noWrite("Email not found.", "not_found", { statusCode: 404 });
    return { id };
  },
});
