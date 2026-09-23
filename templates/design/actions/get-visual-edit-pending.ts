import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

/**
 * The MCP-facing half of the browser publication handshake. Keeping this as a
 * normal read action means CLI, Claude Code, and Codex use the same access
 * check and result shape instead of inventing a Design-specific transport.
 */
export default defineAction({
  description:
    "KEY HANDOFF: Pull the latest pending visual edits from the Design canvas for a coding agent. Call this after the user says they made visual edits and before asking them to copy or paste anything. It works without the Design tab, returns the precise prompt with source context when status is ready, and does not write app source. If status is empty, there are no pending edits to apply.",
  schema: z.object({
    designId: z
      .string()
      .describe("Design project ID from the visual-edit URL."),
  }),
  readOnly: true,
  requiresAuth: false,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: false,
    title: "Pull visual edits from Design",
    description:
      "Highlighted handoff tool: retrieve the latest pending visual-edit prompt without requiring the Design tab to remain open.",
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
      updatedAt: pending?.updatedAt ?? null,
      next:
        pending?.status === "ready"
          ? "Apply this prompt to the connected app source, then refresh the visual-edit screen and call this tool again to verify the handoff cleared."
          : "Ask the user to make or keep visual edits in Design, then call this tool again.",
    };
  },
});
