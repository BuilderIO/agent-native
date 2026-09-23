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

// A row that's reported "indexing" for this long with no confirmed change is
// very unlikely to ever resolve on its own — Builder's own hydrate call
// already ran (above) and still couldn't confirm completion. Long enough
// that a real, slow index isn't mistaken for stuck.
const STALE_INDEXING_TIMEOUT_MS = 30 * 60_000;

function isStaleIndexingRow(resource: {
  updatedAt?: unknown;
  createdAt?: unknown;
}): boolean {
  const lastObservedAt =
    typeof resource.updatedAt === "string"
      ? resource.updatedAt
      : resource.createdAt;
  if (typeof lastObservedAt !== "string") return false;
  const lastObservedMs = new Date(lastObservedAt).getTime();
  return (
    Number.isFinite(lastObservedMs) &&
    Date.now() - lastObservedMs > STALE_INDEXING_TIMEOUT_MS
  );
}

export default defineAction({
  description:
    "Re-check a Builder-indexed design system's live status against Builder " +
    "and persist it if indexing finished (or failed) since it was created or " +
    "last synced. list-design-systems only reads the status persisted at " +
    "index/sync time, so a completed system would otherwise stay reported as " +
    "'indexing' forever. No-op (and no Builder call) for a locally authored " +
    "design system. Reports `stale: true` (without writing anything) when a " +
    "row has read as unconfirmed 'indexing' for a long time, so a poller can " +
    "stop checking it without ever claiming it's ready.",
  schema: z.object({
    id: z.string().min(1).describe("Local design system id"),
  }),
  run: async ({ id }) => {
    const access = await assertAccess("design-system", id, "viewer");
    const reference = parseBuilderDesignSystemProxyReference(
      access.resource.data,
    );
    if (!reference) {
      return {
        id,
        indexingStatus: "ready" as const,
        updated: false,
        stale: false,
      };
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
      const stale =
        indexingStatus === "indexing" && isStaleIndexingRow(access.resource);
      return { id, indexingStatus, updated: false, stale };
    }

    // Re-read immediately before writing instead of reusing the snapshot from
    // before the (network-bound) hydrate call above — a concurrent
    // update-design-system or re-sync during that window would otherwise be
    // silently overwritten by patching the stale copy's builderStatus back.
    const db = getDb();
    const [currentRow] = await db
      .select({ data: schema.designSystems.data })
      .from(schema.designSystems)
      .where(eq(schema.designSystems.id, id))
      .limit(1);
    if (!currentRow) {
      return { id, indexingStatus, updated: false, stale: false };
    }
    const currentReference = parseBuilderDesignSystemProxyReference(
      currentRow.data,
    );
    if (
      !currentReference ||
      currentReference.builderStatus === resolvedBuilderStatus
    ) {
      // No longer a Builder-backed row, or another writer already recorded
      // this same status while we were hydrating.
      return { id, indexingStatus, updated: false, stale: false };
    }

    const parsed = JSON.parse(currentRow.data) as Record<string, unknown>;
    parsed.builderStatus = resolvedBuilderStatus;
    await db
      .update(schema.designSystems)
      .set({
        data: JSON.stringify(parsed),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.designSystems.id, id));

    return { id, indexingStatus, updated: true, stale: false };
  },
});
