import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { factoryGraphVersions } from "../server/db/schema.js";
import {
  DEFAULT_FACTORY_ID,
  parseFactoryGraph,
  readFactoryDefinition,
} from "../server/factory-graph/store.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Read one validated Factory visual graph version for history preview. The snapshot is scoped to the active workspace and does not change the current Factory.",
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
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async ({ factoryId, versionId }, context) => {
    const { orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const currentDefinition = await readFactoryDefinition(orgId, factoryId);
    const currentVersion = currentDefinition?.graphVersion ?? null;
    const row = (
      await getDb()
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

    if (!row) {
      throw new Error("Factory graph version not found.");
    }

    return {
      id: row.id,
      factoryId: row.factoryId,
      version: row.version,
      graph: parseFactoryGraph(row.graphJson),
      source: row.source,
      changeSummary: row.changeSummary,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      isCurrent: currentVersion === row.version,
    };
  },
});
