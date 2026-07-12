import { defineAction } from "@agent-native/core";
import { completeText } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { sanitizeGeneratedDesignTitle } from "../shared/prompt-title.js";

const TITLE_SYSTEM_PROMPT =
  "Generate a very short title (2-5 words) for a design/prototype that " +
  "starts from this brief. Title Case, no quotes, no trailing punctuation. " +
  "Return only the title, nothing else.";

export default defineAction({
  description:
    "Generate a concise, human-friendly title for a design from its " +
    "generation prompt and save it. Internal plumbing used right after a " +
    "design is created from the prompt box — not a step in the normal " +
    "design-generation flow, so agents should not call this directly.",
  // UI-only plumbing: callable via the frontend action surface, hidden from
  // the agent/MCP/A2A tool lists so it doesn't spend a tool-call slot.
  agentTool: false,
  schema: z.object({
    designId: z.string().describe("Design ID to update"),
    prompt: z.string().describe("The user's original generation prompt"),
    previousTitle: z
      .string()
      .optional()
      .describe(
        "The placeholder title written when the design was created. If the " +
          "design's current title no longer matches this (the user renamed " +
          "it in the meantime), the generated title is discarded.",
      ),
  }),
  run: async ({ designId, prompt, previousTitle }) => {
    await assertAccess("design", designId, "editor");

    const cleanPrompt = prompt.replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!cleanPrompt) return { updated: false, reason: "empty-prompt" };

    let generated: string | null = null;
    try {
      const result = await completeText({
        systemPrompt: TITLE_SYSTEM_PROMPT,
        input: cleanPrompt.slice(0, 500),
        maxOutputTokens: 30,
        temperature: 0.3,
        timeoutMs: 15_000,
      });
      generated = sanitizeGeneratedDesignTitle(result.text);
    } catch {
      // Best-effort: the placeholder title (already saved at creation time)
      // stays as-is on any model/engine failure.
      return { updated: false, reason: "generation-failed" };
    }

    if (!generated) return { updated: false, reason: "empty-result" };

    const db = getDb();
    const now = new Date().toISOString();

    // Read-then-write inside one transaction so we only overwrite the
    // placeholder title — never a title the user already changed in the
    // meantime (manual rename racing this background call).
    const outcome = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ title: schema.designs.title })
        .from(schema.designs)
        .where(eq(schema.designs.id, designId));

      if (!current) return { updated: false, reason: "not-found" as const };
      if (previousTitle !== undefined && current.title !== previousTitle) {
        return { updated: false, reason: "title-changed" as const };
      }

      await tx
        .update(schema.designs)
        .set({ title: generated, updatedAt: now })
        .where(eq(schema.designs.id, designId));

      return { updated: true as const, title: generated };
    });

    return outcome;
  },
});
