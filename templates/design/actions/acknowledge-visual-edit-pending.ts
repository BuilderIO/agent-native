import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "KEY HANDOFF: Acknowledge one visual-edit handoff revision after the coding agent has applied it to app source. Never acknowledge before the source change is verified; stale revisions are rejected without clearing newer edits.",
  schema: z.object({
    designId: z.string().describe("Visual-edit design ID."),
    revision: z
      .number()
      .int()
      .positive()
      .describe("The revision returned by get-visual-edit-pending."),
  }),
  requiresAuth: false,
  agentTool: false,
  mcpTool: true,
  capabilityScopes: ["visual-edit"],
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: false,
    title: "Mark visual edits applied",
    description:
      "Clear exactly the handoff revision you already applied to source; newer visual edits remain pending.",
  },
  http: { method: "POST" },
  maxBodyBytes: 1_024,
  run: async ({ designId, revision }) => {
    await assertAccess("design", designId, "editor");

    const updated = await getDb()
      .update(schema.designVisualEditPending)
      .set({
        pendingEditCount: 0,
        status: "empty",
        prompt: "",
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.designVisualEditPending.designId, designId),
          eq(schema.designVisualEditPending.revision, revision),
        ),
      )
      .returning({ designId: schema.designVisualEditPending.designId });

    const cleared = updated.length > 0;
    return {
      designId,
      revision,
      status: cleared ? "empty" : "stale",
      pendingEditCount: cleared ? 0 : null,
      next: cleared
        ? "Call get-visual-edit-pending again to verify the handoff is empty."
        : "A newer handoff replaced this revision; call get-visual-edit-pending and apply the latest revision instead.",
    };
  },
});
