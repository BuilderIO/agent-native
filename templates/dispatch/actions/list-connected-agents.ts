import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  discoverAgents,
  getBuiltinAgents,
} from "@agent-native/core/server/agent-discovery";
import { getRequestUserEmail } from "@agent-native/core/server";
import {
  resourceGet,
  resourceListAccessible,
  SHARED_OWNER,
} from "@agent-native/core/resources/store";
import { parseRemoteAgentManifest } from "@agent-native/core/resources/metadata";

export default defineAction({
  description:
    "List agents available to dispatch for A2A delegation, including built-in apps and connected remote agents.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const discovered = await discoverAgents("dispatch");
    const builtinIds = new Set(
      getBuiltinAgents("dispatch").map((agent) => agent.id),
    );
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const resources = await resourceListAccessible(ownerEmail, "agents/");
    const customById = new Map<
      string,
      { resourceId: string; path: string; scope: "shared" | "personal" }
    >();

    // Only treat a resource as a "custom" agent if its id is not a builtin.
    // Built-in agents may also be seeded as shared resources so the agent-chat
    // plugin can overlay them — those should still be reported as builtin.
    for (const resource of resources) {
      if (!resource.path.endsWith(".json")) continue;
      const full = await resourceGet(resource.id);
      if (!full) continue;
      const manifest = parseRemoteAgentManifest(full.content, resource.path);
      if (!manifest) continue;
      if (builtinIds.has(manifest.id)) continue;
      customById.set(manifest.id, {
        resourceId: resource.id,
        path: resource.path,
        scope: resource.owner === SHARED_OWNER ? "shared" : "personal",
      });
    }

    return discovered.map((agent) => {
      const custom = customById.get(agent.id);
      const isBuiltin = builtinIds.has(agent.id);
      return {
        ...agent,
        source: isBuiltin ? "builtin" : custom ? "custom" : "builtin",
        resourceId: custom?.resourceId,
        path: custom?.path,
        scope: custom?.scope,
      };
    });
  },
});
