import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  factoryDefinitions,
  factoryGraphVersions,
} from "../server/db/schema.js";
import { normalizeFactoryGraph } from "../server/factory-graph/contracts.js";
import {
  DEFAULT_FACTORY_ID,
  parseFactoryGraph,
} from "../server/factory-graph/store.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { stableId } from "../server/triage/ids.js";

export default defineAction({
  description:
    "Restore a Factory visual graph version. Restoring never deletes history: it validates the selected snapshot, appends it as a new version, and makes that new version current while preserving the Factory prompt.",
  schema: z.object({
    factoryId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .default(DEFAULT_FACTORY_ID),
    versionId: z.string().trim().min(1).max(240),
  }),
  link: ({ result }) => ({
    url: buildDeepLink({
      app: "factory",
      view: "factory",
      params: { factoryId: result.factoryId, tab: "history" },
    }),
    label: `Open ${result.name} history in Factory`,
  }),
  run: async ({ factoryId, versionId }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const db = getDb();

    return db.transaction(async (tx) => {
      const definition = (
        await tx
          .select()
          .from(factoryDefinitions)
          .where(
            and(
              eq(factoryDefinitions.id, factoryId),
              eq(factoryDefinitions.orgId, orgId),
            ),
          )
          .limit(1)
      )[0];
      if (!definition) {
        throw new Error("Factory has no saved definition to restore.");
      }

      const version = (
        await tx
          .select()
          .from(factoryGraphVersions)
          .where(
            and(
              eq(factoryGraphVersions.id, versionId),
              eq(factoryGraphVersions.factoryId, factoryId),
              eq(factoryGraphVersions.orgId, orgId),
            ),
          )
          .limit(1)
      )[0];
      if (!version) {
        throw new Error("Factory graph version not found.");
      }

      if (version.version === definition.graphVersion) {
        return {
          ok: true,
          alreadyCurrent: true,
          factoryId,
          versionId: version.id,
          restoredFromVersion: version.version,
          graphVersion: definition.graphVersion,
          name: definition.name,
          source: "restore" as const,
        };
      }

      const nextVersion = definition.graphVersion + 1;
      const restoredGraph = normalizeFactoryGraph({
        ...parseFactoryGraph(version.graphJson),
        version: nextVersion,
      });
      const now = new Date().toISOString();
      const nextVersionId = stableId(
        "factory-graph",
        orgId,
        factoryId,
        String(nextVersion),
      );
      const changeSummary = `Restored version ${version.version}.`;

      const updated = await tx
        .update(factoryDefinitions)
        .set({
          name: restoredGraph.name,
          description: restoredGraph.description,
          graphVersion: nextVersion,
          graphJson: JSON.stringify(restoredGraph),
          updatedAt: now,
          ownerEmail: userEmail,
        })
        .where(
          and(
            eq(factoryDefinitions.id, factoryId),
            eq(factoryDefinitions.orgId, orgId),
            eq(factoryDefinitions.graphVersion, definition.graphVersion),
          ),
        )
        .returning({ id: factoryDefinitions.id });
      if (updated.length === 0) {
        throw new Error(
          "Factory changed while restoring. Refresh history and try again.",
        );
      }

      await tx.insert(factoryGraphVersions).values({
        id: nextVersionId,
        factoryId,
        version: nextVersion,
        graphJson: JSON.stringify(restoredGraph),
        source: "restore",
        changeSummary,
        createdAt: now,
        createdBy: userEmail,
        ownerEmail: userEmail,
        orgId,
      });

      return {
        ok: true,
        alreadyCurrent: false,
        factoryId,
        versionId: nextVersionId,
        restoredFromVersion: version.version,
        graphVersion: nextVersion,
        name: restoredGraph.name,
        source: "restore" as const,
      };
    });
  },
});
