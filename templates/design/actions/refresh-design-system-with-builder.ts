import {
  AgentActionStopError,
  defineAction,
  type ActionRunContext,
} from "@agent-native/core/action";
import {
  hydrateBuilderDesignSystemReference,
  parseBuilderDesignSystemProxyReference,
} from "@agent-native/core/server";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, ne, notExists } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { reconcileBuilderProxyData } from "../server/lib/builder-design-system-proxy.js";

function persistedBuilderSyncMatches(data: unknown, syncedAt: string): boolean {
  if (typeof data !== "string") return false;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    return (
      parsed.builderStatus === "ready" && parsed.builderSyncedAt === syncedAt
    );
  } catch {
    throw new Error(
      "The design system data became invalid while Builder DSI was syncing.",
    );
  }
}

function stopAgentOnUnsyncedResult<
  TResult extends { synced: false; message: string },
>(result: TResult, context?: Pick<ActionRunContext, "caller">): TResult {
  if (context?.caller === "tool") {
    throw new AgentActionStopError(result.message, {
      errorCode: "builder_dsi_refresh_incomplete",
      toolResult: JSON.stringify(result),
    });
  }
  return result;
}

export default defineAction({
  description:
    "Refresh a Builder-backed design-system proxy after checking Builder indexing status; if syncing is incomplete, the agent turn stops and the returned status says when to retry.",
  schema: z.object({
    id: z.string().min(1).describe("Local design system id"),
  }),
  run: async ({ id }, context) => {
    await assertAccess("design-system", id, "editor");
    const access = await resolveAccess("design-system", id);
    if (!access) throw new Error("Design system not found");

    const reference = parseBuilderDesignSystemProxyReference(
      access.resource.data,
    );
    if (!reference) {
      throw new Error("This design system is not a Builder-backed proxy.");
    }

    const hydrated = await hydrateBuilderDesignSystemReference(reference);
    const syncedAt = new Date().toISOString();
    const reconciliation = reconcileBuilderProxyData(
      access.resource.data,
      hydrated,
      syncedAt,
    );
    if (!reconciliation) {
      return stopAgentOnUnsyncedResult(
        {
          id,
          synced: false,
          status:
            hydrated.builderStatus ?? reference.builderStatus ?? "in-progress",
          docCount: hydrated.docCount,
          tokenCount: 0,
          message:
            "Builder DSI has not returned usable token values yet. Do not call this refresh again in the same turn; check Builder status later.",
        },
        context,
      );
    }

    if (reconciliation.rejectedTokenCount > 0) {
      return stopAgentOnUnsyncedResult(
        {
          id,
          synced: false,
          status: "incomplete",
          docCount: hydrated.docCount,
          tokenCount: reconciliation.tokenCount,
          rejectedTokenCount: reconciliation.rejectedTokenCount,
          message: `Builder DSI returned ${reconciliation.rejectedTokenCount} token(s) that could not be safely imported.`,
        },
        context,
      );
    }

    if (!reconciliation.completionConfirmed) {
      return stopAgentOnUnsyncedResult(
        {
          id,
          synced: false,
          status:
            hydrated.builderStatus ?? reference.builderStatus ?? "in-progress",
          docCount: hydrated.docCount,
          tokenCount: reconciliation.tokenCount,
          rejectedTokenCount: 0,
          message:
            "Builder DSI returned token values without confirming that indexing is complete. Do not call this refresh again in the same turn; retry only after Builder reports completion.",
        },
        context,
      );
    }

    await assertAccess("design-system", id, "editor");
    const latestAccess = await resolveAccess("design-system", id);
    if (!latestAccess) throw new Error("Design system not found");
    if (
      latestAccess.resource.id !== access.resource.id ||
      latestAccess.resource.data !== access.resource.data
    ) {
      return stopAgentOnUnsyncedResult(
        {
          id,
          synced: false,
          status: "conflict",
          docCount: hydrated.docCount,
          tokenCount: reconciliation.tokenCount,
          rejectedTokenCount: 0,
          message:
            "The design system changed while Builder DSI was syncing. Retry the refresh after checking the latest design system state.",
        },
        context,
      );
    }

    const db = getDb();
    const persistedUpdate = await db.transaction(async (tx) => {
      const targetScope = latestAccess.resource.orgId
        ? and(
            eq(
              schema.designSystems.ownerEmail,
              latestAccess.resource.ownerEmail,
            ),
            eq(schema.designSystems.orgId, latestAccess.resource.orgId),
          )
        : and(
            eq(
              schema.designSystems.ownerEmail,
              latestAccess.resource.ownerEmail,
            ),
            isNull(schema.designSystems.orgId),
          );
      const [updated] = await tx
        .update(schema.designSystems)
        .set({ data: reconciliation.data, updatedAt: syncedAt })
        .where(
          and(
            eq(schema.designSystems.id, latestAccess.resource.id),
            eq(schema.designSystems.data, latestAccess.resource.data),
            targetScope,
          ),
        )
        .returning({ id: schema.designSystems.id });
      if (!updated) return false;

      await tx
        .update(schema.designSystems)
        .set({ isDefault: true, updatedAt: syncedAt })
        .where(
          and(
            eq(schema.designSystems.id, latestAccess.resource.id),
            targetScope,
            notExists(
              tx
                .select({ id: schema.designSystems.id })
                .from(schema.designSystems)
                .where(
                  and(
                    targetScope,
                    eq(schema.designSystems.isDefault, true),
                    ne(schema.designSystems.id, latestAccess.resource.id),
                  ),
                ),
            ),
          ),
        );
      return true;
    });

    if (!persistedUpdate) {
      return stopAgentOnUnsyncedResult(
        {
          id,
          synced: false,
          status: "conflict",
          docCount: hydrated.docCount,
          tokenCount: reconciliation.tokenCount,
          rejectedTokenCount: 0,
          message:
            "The design system changed while Builder DSI was syncing. Retry the refresh after checking the latest design system state.",
        },
        context,
      );
    }

    const persisted = await resolveAccess("design-system", id);
    if (!persistedBuilderSyncMatches(persisted?.resource?.data, syncedAt)) {
      return stopAgentOnUnsyncedResult(
        {
          id,
          synced: false,
          status: "conflict",
          docCount: hydrated.docCount,
          tokenCount: reconciliation.tokenCount,
          rejectedTokenCount: 0,
          message:
            "The design system changed while Builder DSI was syncing. Retry the refresh after checking the latest design system state.",
        },
        context,
      );
    }

    return {
      id,
      synced: true,
      status: "ready",
      docCount: hydrated.docCount,
      tokenCount: reconciliation.tokenCount,
      rejectedTokenCount: reconciliation.rejectedTokenCount,
      syncedAt,
    };
  },
});
