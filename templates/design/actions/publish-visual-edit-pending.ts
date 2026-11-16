import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";
import { isSameOriginVisualEditBrowserRequest } from "./visual-edit-browser-request.js";

const MAX_PROMPT_LENGTH = 64 * 1024;
const MAX_CLIENT_REVISION = 2_147_483_647;

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
    "Publish the current DOM-only visual-edit handoff for the Design page so an external coding agent can retrieve it. Editor handoffs are ready to apply; commenter handoffs are stored as suggestions that need the owner's approval. Browser-only transport; this does not write design files or app source.",
  requiresAuth: false,
  agentTool: false,
  mcpTool: false,
  capabilityScopes: ["visual-edit"],
  maxBodyBytes: MAX_PROMPT_LENGTH + 8_192,
  schema: z.object({
    designId: z.string().describe("Design project ID."),
    publisherId: z.string().uuid().describe("This browser's handoff identity."),
    revision: z
      .number()
      .int()
      .positive()
      .max(MAX_CLIENT_REVISION)
      .describe("Monotonic revision from this Design browser."),
    pending: pendingSchema.describe(
      "The current visual-edit handoff, or null after the edits are applied or discarded.",
    ),
  }),
  run: async ({ designId, publisherId, revision, pending }, ctx) => {
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

    return withDesignSourceMutationTransaction(designId, async (tx) => {
      const access = await assertAccess("design", designId, "viewer");
      const design = access.resource as typeof schema.designs.$inferSelect;
      if (!["owner", "admin", "editor", "commenter"].includes(access.role)) {
        fail("Comment access is required to suggest visual edits.", {
          statusCode: 403,
          errorCode: "visual_edit_comment_access_required",
        });
      }
      const now = new Date().toISOString();
      const canEditDesign = ["owner", "admin", "editor"].includes(access.role);
      const canClearOtherPublisher = access.role === "owner";
      // A commenter cannot change source, so their text must never reach the
      // owner's coding agent as an instruction; it waits for owner approval.
      const status = pending
        ? canEditDesign
          ? ("ready" as const)
          : ("suggested" as const)
        : ("empty" as const);
      const values = {
        designId,
        revision: 1,
        publisherId,
        clientRevision: revision,
        pendingEditCount: pending?.pendingEditCount ?? 0,
        status,
        prompt: pending?.prompt ?? "",
        authorEmail: pending ? (getRequestUserEmail() ?? null) : null,
        updatedAt: now,
        visibility: design.visibility,
        ownerEmail: design.ownerEmail,
        orgId: design.orgId,
      };

      const samePublisherIsNewer = sql`${schema.designVisualEditPending.publisherId} = excluded.publisher_id AND ${schema.designVisualEditPending.clientRevision} < excluded.client_revision`;
      const fromNewPublisher = sql`${schema.designVisualEditPending.publisherId} IS DISTINCT FROM excluded.publisher_id`;
      const fromNewPublisherToOpen = sql`(${fromNewPublisher} AND ${schema.designVisualEditPending.status} NOT IN ('ready', 'suggested'))`;
      const updated = await tx
        .insert(schema.designVisualEditPending)
        .values(values)
        .onConflictDoUpdate({
          target: schema.designVisualEditPending.designId,
          set: {
            pendingEditCount: values.pendingEditCount,
            status: values.status,
            prompt: values.prompt,
            authorEmail: values.authorEmail,
            revision: sql`${schema.designVisualEditPending.revision} + 1`,
            publisherId: values.publisherId,
            clientRevision: values.clientRevision,
            updatedAt: values.updatedAt,
            visibility: values.visibility,
            ownerEmail: values.ownerEmail,
            orgId: values.orgId,
          },
          setWhere:
            pending === null
              ? sql`(${samePublisherIsNewer} OR ${canClearOtherPublisher ? fromNewPublisher : fromNewPublisherToOpen})`
              : sql`(${samePublisherIsNewer} OR ${fromNewPublisherToOpen})`,
        })
        .returning({ revision: schema.designVisualEditPending.revision });

      if (!updated.length && (pending !== null || !canEditDesign)) {
        const [current] = await tx
          .select({
            status: schema.designVisualEditPending.status,
            publisherId: schema.designVisualEditPending.publisherId,
          })
          .from(schema.designVisualEditPending)
          .where(eq(schema.designVisualEditPending.designId, designId))
          .limit(1);

        if (
          (current?.status === "ready" || current?.status === "suggested") &&
          current.publisherId !== publisherId
        ) {
          if (pending === null) {
            return {
              designId,
              pendingEditCount: null,
              status: "stale" as const,
              revision: null,
              updatedAt: null,
            };
          }
          fail(
            "Another collaborator has visual edits waiting to be applied. Apply or clear those edits before publishing new ones.",
            {
              errorCode: "visual_edit_pending_conflict",
              statusCode: 409,
            },
          );
        }
      }

      return {
        designId,
        pendingEditCount: updated.length ? values.pendingEditCount : null,
        status: updated.length ? values.status : "stale",
        revision: updated[0]?.revision ?? null,
        updatedAt: updated.length ? now : null,
      };
    });
  },
});
