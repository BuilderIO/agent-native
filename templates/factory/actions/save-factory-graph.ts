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
import { DEFAULT_FACTORY_ID } from "../server/factory-graph/store.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { ensureFactoryAutomations } from "../server/plugins/factory-scheduler-job.js";
import { stableId } from "../server/triage/ids.js";

function chatContextFromAction(
  context:
    | {
        caller?: string;
        threadId?: unknown;
        runId?: unknown;
        turnId?: unknown;
      }
    | undefined,
): Record<string, string> | undefined {
  if (!context) return undefined;
  if (
    context.caller !== "tool" &&
    context.caller !== "mcp" &&
    context.caller !== "a2a"
  ) {
    return undefined;
  }
  const chatContext = Object.fromEntries(
    ["threadId", "runId", "turnId"].flatMap((key) =>
      typeof context[key as keyof typeof context] === "string" &&
      (context[key as keyof typeof context] as string).trim()
        ? [[key, context[key as keyof typeof context] as string]]
        : [],
    ),
  );
  return chatContext.runId || chatContext.turnId ? chatContext : undefined;
}

export default defineAction({
  description:
    "Create or update a Factory's versioned visual graph. Pass expectedGraphVersion from the graph you inspected so stale edits are rejected. Use source=ai for an agent-proposed graph and source=manual for a direct editor save. This changes configuration only; it never starts provider work.",
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
    expectedGraphVersion: z.coerce.number().int().nonnegative(),
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
    {
      factoryId,
      name,
      description,
      prompt,
      source,
      changeSummary,
      expectedGraphVersion,
      graph,
    },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const chatContext = chatContextFromAction(context);
    const db = getDb();
    let createdNewFactory = false;

    const result = await db.transaction(async (tx) => {
      const existing = (
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
      if ((existing?.graphVersion ?? 0) !== expectedGraphVersion) {
        throw new Error(
          "Factory changed while saving. Refresh the Factory and try again.",
        );
      }
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

      if (existing) {
        const updated = await tx
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
              eq(factoryDefinitions.graphVersion, expectedGraphVersion),
            ),
          )
          .returning({ id: factoryDefinitions.id });
        if (updated.length === 0) {
          throw new Error(
            "Factory changed while saving. Refresh the Factory and try again.",
          );
        }
      } else {
        createdNewFactory = true;
        await tx.insert(factoryDefinitions).values({
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

      await tx.insert(factoryGraphVersions).values({
        id: versionId,
        factoryId,
        version: nextVersion,
        graphJson: JSON.stringify(normalizedGraph),
        source,
        changeSummary,
        createdAt: now,
        createdBy: userEmail,
        ...(chatContext ? { chatContext: JSON.stringify(chatContext) } : {}),
        ownerEmail: userEmail,
        orgId,
      });

      return {
        ok: true,
        factoryId,
        name,
        graphVersion: nextVersion,
        source,
      };
    });
    if (createdNewFactory) {
      await ensureFactoryAutomations(userEmail, orgId, factoryId, {
        enabled: false,
      });
    }
    return result;
  },
});
