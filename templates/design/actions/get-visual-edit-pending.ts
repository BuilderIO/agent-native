import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";

export default defineAction({
  title: "Pull pending visual edits into app source",
  description:
    "Key coding-agent handoff: when a user asks you to apply edits from a live Design canvas, call this instead of asking for copy/paste. Returns the latest implementation prompt, source provenance, and revision, even when the Design tab is closed. Apply the prompt to connected app source, verify the running app, then acknowledge only that revision and call again to confirm it cleared. This read-only tool retrieves edits; it does not modify source. An empty status means no handoff has been published.",
  schema: z.object({
    designId: z
      .string()
      .describe("Design project ID from the visual-edit URL."),
  }),
  readOnly: true,
  requiresAuth: false,
  capabilityScopes: ["visual-edit"],
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: false,
    title: "Pull pending visual edits into app source",
    description:
      "Key handoff for coding agents: retrieve the latest pending live-canvas edit prompt and revision without requiring the Design tab to remain open.",
  },
  mcpTool: true,
  http: { method: "GET" },
  maxResultChars: 64 * 1024,
  run: async ({ designId }) => {
    await assertAccess("design", designId, "editor");

    const [pending] = await getDb()
      .select({
        pendingEditCount: schema.designVisualEditPending.pendingEditCount,
        status: schema.designVisualEditPending.status,
        prompt: schema.designVisualEditPending.prompt,
        revision: schema.designVisualEditPending.revision,
        updatedAt: schema.designVisualEditPending.updatedAt,
      })
      .from(schema.designVisualEditPending)
      .where(eq(schema.designVisualEditPending.designId, designId))
      .limit(1);

    return {
      designId,
      pendingEditCount: pending?.pendingEditCount ?? 0,
      status: pending?.status ?? "empty",
      prompt: pending?.prompt ?? "",
      revision: pending?.revision ?? null,
      updatedAt: pending?.updatedAt ?? null,
      next:
        pending?.status === "ready"
          ? `Apply this prompt to the connected app source. Then call acknowledge-visual-edit-pending with { designId: "${designId}", revision: ${pending.revision} } only after the source change is applied, and call this tool again to verify the handoff cleared.`
          : "Ask the user to make or keep visual edits in Design, then call this tool again.",
    };
  },
});
