import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { discoverAgents } from "@agent-native/core/server/agent-discovery";
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
    const ownerEmail = process.env.AGENT_USER_EMAIL || "local@localhost";
    const resources = await resourceListAccessible(ownerEmail, "agents/");
    const customById = new Map<
      string,
      { resourceId: string; path: string; scope: "shared" | "personal" }
    >();

    for (const resource of resources) {
      if (!resource.path.endsWith(".json")) continue;
      const full = await resourceGet(resource.id);
      if (!full) continue;
      const manifest = parseRemoteAgentManifest(full.content, resource.path);
      if (!manifest) continue;
      customById.set(manifest.id, {
        resourceId: resource.id,
        path: resource.path,
        scope: resource.owner === SHARED_OWNER ? "shared" : "personal",
      });
    }

    return discovered.map((agent) => {
      const custom = customById.get(agent.id);
      return {
        ...agent,
        source: custom ? "custom" : "builtin",
        resourceId: custom?.resourceId,
        path: custom?.path,
        scope: custom?.scope,
      };
    });
  },
});
