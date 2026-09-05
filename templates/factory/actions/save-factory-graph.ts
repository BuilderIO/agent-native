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
  defaultFactoryDefinition,
} from "../server/factory-graph/store.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
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
    "Update an existing Factory's versioned visual map. Do not use this to create a factory or an automation. Do not rename a factory from an AI save — keep the current name. Pass expectedGraphVersion from the graph you inspected so stale edits are rejected. Use source=ai for an agent-proposed graph and source=manual for a direct editor save. This changes configuration only; it never starts provider work.",
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
      if (!existing && factoryId !== DEFAULT_FACTORY_ID) {
        throw new Error(
          "Factory not found. Use create-factory to create a named Factory, then save the map.",
        );
      }
      const fallback = defaultFactoryDefinition();
      // Virtual default is advertised as graphVersion 1 before the first row.
      // Other missing IDs stay 0 so a stale create cannot slip through as v1.
      const currentVersion =
        existing?.graphVersion ??
        (factoryId === DEFAULT_FACTORY_ID ? fallback.graphVersion : 0);
      if (currentVersion !== expectedGraphVersion) {
        throw new Error(
          "Factory changed while saving. Refresh the Factory and try again.",
        );
      }
      const nextName =
        source === "ai" ? (existing?.name ?? fallback.name) : name;
      const nextDescription =
        source === "ai"
          ? (existing?.description ?? fallback.description)
          : description;
      const nextVersion = currentVersion + 1;
      const normalizedGraph = normalizeFactoryGraph({
        ...graph,
        version: nextVersion,
        name: nextName,
        description: nextDescription,
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
            name: nextName,
            description: nextDescription,
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
        await tx.insert(factoryDefinitions).values({
          id: factoryId,
          name: nextName,
          description: nextDescription,
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
        name: nextName,
        graphVersion: nextVersion,
        source,
      };
    });
    return result;
  },
});
