import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isSameOriginVisualEditBrowserRequest } from "./visual-edit-browser-request.js";

const MAX_PROMPT_LENGTH = 64 * 1024;

const pendingSchema = z
  .object({
    designId: z.string(),
    pendingEditCount: z.number().int().positive(),
    status: z.literal("ready"),
    prompt: z.string().min(1).max(MAX_PROMPT_LENGTH),
  })
  .nullable();

export default defineAction({
  description:
    "Publish the current DOM-only visual-edit handoff for the Design page so an external coding agent can retrieve it. Browser-only transport; this does not write design files or app source.",
  requiresAuth: false,
  agentTool: false,
  mcpTool: false,
  capabilityScopes: ["visual-edit"],
  maxBodyBytes: MAX_PROMPT_LENGTH + 8_192,
  schema: z.object({
    designId: z.string().describe("Design project ID."),
    pending: pendingSchema.describe(
      "The current visual-edit handoff, or null after the edits are applied or discarded.",
    ),
  }),
  run: async ({ designId, pending }, ctx) => {
    if (!isSameOriginVisualEditBrowserRequest(ctx)) {
      fail(
        "Visual-edit handoff publication is available only from the same-origin Design page.",
        { errorCode: "signed_out_visual_edit_browser_required" },
      );
    }
    if (pending && pending.designId !== designId) {
      fail("Visual-edit handoff design does not match the request.", {
        errorCode: "visual_edit_design_mismatch",
      });
    }

    const access = await assertAccess("design", designId, "editor");
    const design = access.resource as typeof schema.designs.$inferSelect;
    const now = new Date().toISOString();
    const values = {
      designId,
      pendingEditCount: pending?.pendingEditCount ?? 0,
      status: pending?.status ?? ("empty" as const),
      prompt: pending?.prompt ?? "",
      updatedAt: now,
      visibility: design.visibility,
      ownerEmail: design.ownerEmail,
      orgId: design.orgId,
    };

    await getDb()
      .insert(schema.designVisualEditPending)
      .values(values)
      .onConflictDoUpdate({
        target: schema.designVisualEditPending.designId,
        set: {
          pendingEditCount: values.pendingEditCount,
          status: values.status,
          prompt: values.prompt,
          updatedAt: values.updatedAt,
          visibility: values.visibility,
          ownerEmail: values.ownerEmail,
          orgId: values.orgId,
        },
      });

    return {
      designId,
      pendingEditCount: values.pendingEditCount,
      status: values.status,
      updatedAt: now,
    };
  },
});
