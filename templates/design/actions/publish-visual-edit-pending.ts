import { defineAction, fail } from "@agent-native/core/action";
import { visualEditCapabilityDesignId } from "@agent-native/core/server";
import {
  getRequestAuthCapability,
  getRequestCapabilitySessionId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";
import {
  MAX_HANDOFF_RECORDS,
  visualEditHandoffRecordSchema,
} from "../shared/visual-edit-handoff.js";
import { isSameOriginVisualEditBrowserRequest } from "./visual-edit-browser-request.js";

const MAX_PROMPT_LENGTH = 64 * 1024;
const MAX_CLIENT_REVISION = 2_147_483_647;

const pendingSchema = z
  .object({
    designId: z.string(),
    pendingEditCount: z.number().int().positive(),
    status: z.literal("ready"),
    prompt: z.string().min(1).max(MAX_PROMPT_LENGTH),
    records: z
      .array(visualEditHandoffRecordSchema)
      .min(1)
      .max(MAX_HANDOFF_RECORDS),
  })
  .refine((pending) => pending.pendingEditCount === pending.records.length, {
    message: "pendingEditCount must equal the number of handoff records.",
    path: ["pendingEditCount"],
  })
  .nullable();

export default defineAction({
  description:
    "Publish the current DOM-only visual-edit handoff for the Design page so an external coding agent can retrieve it. Editor handoffs are ready to apply; commenter handoffs are stored as suggestions that need the owner's approval. Browser-only transport; this does not write design files or app source.",
  requiresAuth: false,
  agentTool: false,
  mcpTool: false,
  capabilityScopes: ["visual-edit"],
  // The composed prompt plus the per-record prompts it was composed from.
  maxBodyBytes: 2 * MAX_PROMPT_LENGTH + 16_384,
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
      const canReplaceSuggestion = canEditDesign;
      const previousRows =
        pending && canReplaceSuggestion
          ? await tx
              .select({
                status: schema.designVisualEditPending.status,
                publisherId: schema.designVisualEditPending.publisherId,
                prompt: schema.designVisualEditPending.prompt,
                authorEmail: schema.designVisualEditPending.authorEmail,
              })
              .from(schema.designVisualEditPending)
              .where(eq(schema.designVisualEditPending.designId, designId))
              .limit(1)
          : [];
      const previous = previousRows.pop();
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
        publisherSessionHash:
          visualEditCapabilityDesignId(getRequestAuthCapability()) === designId
            ? (getRequestCapabilitySessionId() ?? null)
            : null,
        clientRevision: revision,
        pendingEditCount: pending?.pendingEditCount ?? 0,
        status,
        prompt: pending?.prompt ?? "",
        handoffRecords: JSON.stringify(pending?.records ?? []),
        authorEmail: getRequestUserEmail() ?? null,
        updatedAt: now,
        visibility: design.visibility,
        ownerEmail: design.ownerEmail,
        orgId: design.orgId,
      };

      const samePublisherIsNewer = sql`
        ${schema.designVisualEditPending.publisherId} = excluded.publisher_id
        AND ${schema.designVisualEditPending.clientRevision} < excluded.client_revision
        AND (
          (${schema.designVisualEditPending.authorEmail} IS NOT NULL
            AND ${schema.designVisualEditPending.authorEmail} = excluded.author_email)
          OR
          (${schema.designVisualEditPending.publisherSessionHash} IS NOT NULL
            AND ${schema.designVisualEditPending.publisherSessionHash} = excluded.publisher_session_hash)
          OR
          (${schema.designVisualEditPending.authorEmail} IS NULL
            AND ${schema.designVisualEditPending.publisherSessionHash} IS NULL
            AND excluded.author_email IS NULL
            AND excluded.publisher_session_hash IS NULL)
        )
      `;
      const fromNewPublisher = sql`${schema.designVisualEditPending.publisherId} IS DISTINCT FROM excluded.publisher_id`;
      const fromNewPublisherToOpen = sql`(${fromNewPublisher} AND ${schema.designVisualEditPending.status} NOT IN ('ready', 'suggested'))`;
      const fromNewPublisherToSuggested = sql`(${fromNewPublisher} AND ${schema.designVisualEditPending.status} = 'suggested' AND ${canReplaceSuggestion})`;
      const updated = await tx
        .insert(schema.designVisualEditPending)
        .values(values)
        .onConflictDoUpdate({
          target: schema.designVisualEditPending.designId,
          set: {
            pendingEditCount: values.pendingEditCount,
            status: values.status,
            prompt: values.prompt,
            handoffRecords: values.handoffRecords,
            authorEmail: values.authorEmail,
            revision: sql`${schema.designVisualEditPending.revision} + 1`,
            publisherId: values.publisherId,
            publisherSessionHash: values.publisherSessionHash,
            clientRevision: values.clientRevision,
            updatedAt: values.updatedAt,
            visibility: values.visibility,
            ownerEmail: values.ownerEmail,
            orgId: values.orgId,
          },
          setWhere:
            pending === null
              ? sql`(${samePublisherIsNewer} OR ${canClearOtherPublisher ? fromNewPublisher : fromNewPublisherToOpen} OR ${fromNewPublisherToSuggested})`
              : sql`(${samePublisherIsNewer} OR ${fromNewPublisherToOpen} OR ${fromNewPublisherToSuggested})`,
        })
        .returning({ revision: schema.designVisualEditPending.revision });

      if (!updated.length && (pending !== null || !canEditDesign)) {
        const currentRows = previous
          ? [previous]
          : await tx
              .select({
                status: schema.designVisualEditPending.status,
                publisherId: schema.designVisualEditPending.publisherId,
              })
              .from(schema.designVisualEditPending)
              .where(eq(schema.designVisualEditPending.designId, designId))
              .limit(1);
        const current = currentRows.length > 0 ? currentRows[0] : undefined;

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
        ...(updated.length &&
        previous?.status === "suggested" &&
        previous.publisherId !== publisherId
          ? {
              supersededSuggestion: {
                text: previous.prompt,
                authorEmail: previous.authorEmail,
              },
            }
          : {}),
      };
    });
  },
});
