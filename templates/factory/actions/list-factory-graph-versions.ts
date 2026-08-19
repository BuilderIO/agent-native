import { defineAction } from "@agent-native/core/action";
import { and, desc, eq } from "drizzle-orm";
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
    "List the saved visual graph versions for a Factory, newest first. Each version includes a validated graph snapshot that can be previewed or restored without changing the current version until restore is confirmed.",
  schema: z.object({
    factoryId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .default(DEFAULT_FACTORY_ID),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async ({ factoryId }, context) => {
    const { orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const currentDefinition = await readFactoryDefinition(orgId, factoryId);
    const currentVersion = currentDefinition?.graphVersion ?? null;
    const rows = await getDb()
      .select()
      .from(factoryGraphVersions)
      .where(
        and(
          eq(factoryGraphVersions.factoryId, factoryId),
          eq(factoryGraphVersions.orgId, orgId),
        ),
      )
      .orderBy(desc(factoryGraphVersions.version));

    return {
      factoryId,
      currentVersion,
      versions: rows.map((row) => ({
        id: row.id,
        factoryId: row.factoryId,
        version: row.version,
        graph: parseFactoryGraph(row.graphJson),
        source: row.source,
        changeSummary: row.changeSummary,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        isCurrent: currentVersion === row.version,
      })),
    };
  },
});
