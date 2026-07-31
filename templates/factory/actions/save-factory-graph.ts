import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  factoryDefinitions,
  factoryGraphVersions,
} from "../server/db/schema.js";
import {
  factoryGraphSchema,
  normalizeFactoryGraph,
} from "../server/factory-graph/contracts.js";
import {
  DEFAULT_FACTORY_ID,
  readFactoryDefinition,
} from "../server/factory-graph/store.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { stableId } from "../server/triage/ids.js";

export default defineAction({
  description:
    "Create or update a Factory's versioned visual graph. Use source=ai for an agent-proposed graph and source=manual for a direct editor save. This changes configuration only; it never starts provider work.",
  schema: z.object({
    factoryId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .default(DEFAULT_FACTORY_ID),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(""),
    prompt: z.string().trim().max(10_000).default(""),
    source: z.enum(["manual", "ai", "seed"]).default("manual"),
    changeSummary: z.string().trim().max(500).default(""),
    graph: factoryGraphSchema,
  }),
  link: ({ result }) => ({
    url: buildDeepLink({
      app: "factory",
      view: "factory",
      params: { factoryId: result.factoryId },
    }),
    label: `Open ${result.name} in Factory`,
  }),
  run: async (
    { factoryId, name, description, prompt, source, changeSummary, graph },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const db = getDb();
    const existing = await readFactoryDefinition(orgId, factoryId);
    const nextVersion = (existing?.graphVersion ?? 0) + 1;
    const normalizedGraph = normalizeFactoryGraph({
      ...graph,
      version: nextVersion,
      name,
      description,
    });
    const now = new Date().toISOString();
    const versionId = stableId(
      "factory-graph",
      orgId,
      factoryId,
      String(nextVersion),
    );

    await db.insert(factoryGraphVersions).values({
      id: versionId,
      factoryId,
      version: nextVersion,
      graphJson: JSON.stringify(normalizedGraph),
      source,
      changeSummary,
      createdAt: now,
      createdBy: userEmail,
      ownerEmail: userEmail,
      orgId,
    });

    if (existing) {
      await db
        .update(factoryDefinitions)
        .set({
          name,
          description,
          prompt,
          graphVersion: nextVersion,
          graphJson: JSON.stringify(normalizedGraph),
          updatedAt: now,
          ownerEmail: userEmail,
        })
        .where(
          and(
            eq(factoryDefinitions.id, factoryId),
            eq(factoryDefinitions.orgId, orgId),
          ),
        );
    } else {
      await db.insert(factoryDefinitions).values({
        id: factoryId,
        name,
        description,
        prompt,
        graphVersion: nextVersion,
        graphJson: JSON.stringify(normalizedGraph),
        createdAt: now,
        updatedAt: now,
        ownerEmail: userEmail,
        orgId,
      });
    }

    return {
      ok: true,
      factoryId,
      name,
      graphVersion: nextVersion,
      source,
    };
  },
});
