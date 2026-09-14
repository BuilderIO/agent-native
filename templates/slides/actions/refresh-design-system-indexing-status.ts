import { defineAction } from "@agent-native/core/action";
import {
  hydrateBuilderDesignSystemReference,
  parseBuilderDesignSystemProxyReference,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getDesignSystemIndexingStatus } from "../shared/design-system-validation.js";

export default defineAction({
  description:
    "Re-check a Builder-indexed design system's live status against Builder " +
    "and persist it if indexing finished (or failed) since it was created or " +
    "last synced. list-design-systems only reads the status persisted at " +
    "index/sync time, so a completed system would otherwise stay reported as " +
    "'indexing' forever. No-op (and no Builder call) for a locally authored " +
    "design system.",
  schema: z.object({
    id: z.string().min(1).describe("Local design system id"),
  }),
  run: async ({ id }) => {
    const access = await assertAccess("design-system", id, "viewer");
    const reference = parseBuilderDesignSystemProxyReference(
      access.resource.data,
    );
    if (!reference) {
      return { id, indexingStatus: "ready" as const, updated: false };
    }

    const hydrated = await hydrateBuilderDesignSystemReference(reference);
    // Only a confirmed completion or a reported terminal failure is worth
    // persisting — an unconfirmed in-progress read is not new information
    // over what was already stored at index/sync time.
    const resolvedBuilderStatus = hydrated.completionConfirmed
      ? (hydrated.builderStatus ?? "ready")
      : hydrated.builderStatus;
    const indexingStatus = getDesignSystemIndexingStatus({
      source: "builder",
      builderStatus: resolvedBuilderStatus,
    });

    if (
      indexingStatus === "indexing" ||
      resolvedBuilderStatus === reference.builderStatus
    ) {
      return { id, indexingStatus, updated: false };
    }

    const parsed = JSON.parse(access.resource.data) as Record<string, unknown>;
    parsed.builderStatus = resolvedBuilderStatus;
    await getDb()
      .update(schema.designSystems)
      .set({
        data: JSON.stringify(parsed),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.designSystems.id, id));

    return { id, indexingStatus, updated: true };
  },
});
