import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  factoryDefinitions,
  factoryGraphVersions,
} from "../server/db/schema.js";
import {
  minimalFactoryGraph,
  normalizeFactoryGraph,
} from "../server/factory-graph/contracts.js";
import { isFactoryIdConflict } from "../server/lib/factory-automation-plan.js";
import { resolveUniqueFactoryId } from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { stableId } from "../server/triage/ids.js";

export default defineAction({
  description:
    "Create a named empty Factory the same way /new-factory does. Opens that factory's Inbox. Reply with the factory name and that automations start empty. Do not list graph nodes, stages, or graph versions unless the user asked about the map. Add jobs later with create-factory-automation.",
  schema: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
  }),
  http: { method: "POST" },
  link: ({ result }) => ({
    url: buildDeepLink({
      app: "factory",
      view: "factory",
      params: { factoryId: result.factoryId },
      to: `/factory?factoryId=${encodeURIComponent(result.factoryId)}`,
    }),
    label: `Open ${result.name} in Factory`,
  }),
  run: async (input, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const db = getDb();
    const description = input.description?.trim() ?? "";
    const graph = normalizeFactoryGraph(
      minimalFactoryGraph(input.name, description),
    );
    const now = new Date().toISOString();

    const MAX_FACTORY_CREATE_ATTEMPTS = 5;
    let factoryId = "";
    for (let attempt = 0; attempt < MAX_FACTORY_CREATE_ATTEMPTS; attempt++) {
      factoryId = await resolveUniqueFactoryId(db, orgId, input.name);
      const versionId = stableId("factory-graph", orgId, factoryId, "1");
      try {
        await db.transaction(async (tx) => {
          await tx.insert(factoryDefinitions).values({
            id: factoryId,
            name: input.name,
            description,
            prompt: "",
            graphVersion: 1,
            graphJson: JSON.stringify(graph),
            createdAt: now,
            updatedAt: now,
            ownerEmail: userEmail,
            orgId,
          });
          await tx.insert(factoryGraphVersions).values({
            id: versionId,
            factoryId,
            version: 1,
            graphJson: JSON.stringify(graph),
            source: "manual",
            changeSummary: "Created from the new factory dialog.",
            createdAt: now,
            createdBy: userEmail,
            ownerEmail: userEmail,
            orgId,
          });
        });
        break;
      } catch (error) {
        if (
          isFactoryIdConflict(error) &&
          attempt < MAX_FACTORY_CREATE_ATTEMPTS - 1
        ) {
          continue;
        }
        throw error;
      }
    }
    if (!factoryId) {
      throw new Error("Could not allocate a unique factory id.");
    }

    if (
      context?.caller === "tool" ||
      context?.caller === "mcp" ||
      context?.caller === "a2a"
    ) {
      await writeAppStateForCurrentTab("navigate", {
        view: "factory",
        path: `/factory?factoryId=${encodeURIComponent(factoryId)}`,
        _writeId: `${Date.now()}-create-factory`,
      });
    }

    return {
      ok: true,
      factoryId,
      name: input.name,
      graphVersion: 1,
      enabledAutomations: [],
    };
  },
});
