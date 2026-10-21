import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { factoryDefinitions } from "../server/db/schema.js";
import { isFactoryIdConflict } from "../server/lib/factory-automation-plan.js";
import { resolveUniqueFactoryId } from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Create a named empty Factory the same way /new-factory does. Opens that factory's Workflows tab. Reply with the factory name and that workflows start empty. Add workflows later with save-factory-workflow.",
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
    const now = new Date().toISOString();

    const MAX_FACTORY_CREATE_ATTEMPTS = 5;
    let factoryId = "";
    for (let attempt = 0; attempt < MAX_FACTORY_CREATE_ATTEMPTS; attempt++) {
      factoryId = await resolveUniqueFactoryId(db, orgId, input.name);
      try {
        await db.insert(factoryDefinitions).values({
          id: factoryId,
          name: input.name,
          description,
          prompt: "",
          // Legacy NOT NULL columns: this row is the registry, no graph is stored.
          graphVersion: 1,
          graphJson: "{}",
          createdAt: now,
          updatedAt: now,
          ownerEmail: userEmail,
          orgId,
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
      enabledAutomations: [],
    };
  },
});
