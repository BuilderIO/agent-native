import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { factoryGraphVersions } from "../server/db/schema.js";
import {
  DEFAULT_FACTORY_ID,
  readFactoryDefinition,
} from "../server/factory-graph/store.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "List bounded saved visual graph version metadata for a Factory, newest first. Use get-factory-graph-version to read one validated snapshot for preview or restore.",
  schema: z.object({
    factoryId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .default(DEFAULT_FACTORY_ID),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    beforeVersion: z.coerce.number().int().positive().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async ({ factoryId, limit, beforeVersion }, context) => {
    const { orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const currentDefinition = await readFactoryDefinition(orgId, factoryId);
    const currentVersion = currentDefinition?.graphVersion ?? null;
    const rows = await getDb()
      .select({
        id: factoryGraphVersions.id,
        factoryId: factoryGraphVersions.factoryId,
        version: factoryGraphVersions.version,
        source: factoryGraphVersions.source,
        changeSummary: factoryGraphVersions.changeSummary,
        createdAt: factoryGraphVersions.createdAt,
        createdBy: factoryGraphVersions.createdBy,
      })
      .from(factoryGraphVersions)
      .where(
        and(
          eq(factoryGraphVersions.factoryId, factoryId),
          eq(factoryGraphVersions.orgId, orgId),
          beforeVersion === undefined
            ? undefined
            : lt(factoryGraphVersions.version, beforeVersion),
        ),
      )
      .orderBy(desc(factoryGraphVersions.version))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;

    return {
      factoryId,
      currentVersion,
      hasMore,
      nextBeforeVersion:
        hasMore && page.length > 0 ? page[page.length - 1].version : null,
      versions: page.map((row) => ({
        id: row.id,
        factoryId: row.factoryId,
        version: row.version,
        source: row.source,
        changeSummary: row.changeSummary,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        isCurrent: currentVersion === row.version,
      })),
    };
  },
});
