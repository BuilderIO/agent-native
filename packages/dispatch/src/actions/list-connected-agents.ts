import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  discoverAgents,
  getBuiltinAgents,
  shouldIncludeRemoteAgentManifest,
} from "@agent-native/core/server/agent-discovery";
import { getRequestUserEmail } from "@agent-native/core/server";
import {
  resourceGet,
  resourceListAccessible,
  SHARED_OWNER,
} from "@agent-native/core/resources/store";
import {
  REMOTE_AGENT_RESOURCE_PREFIXES,
  parseRemoteAgentManifest,
} from "@agent-native/core/resources/metadata";

export default defineAction({
  description:
    "List agents available to dispatch for A2A delegation, including built-in apps and connected remote agents.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const { hiddenAgentIds = [] } = await import("../server/index.js").then(
      (m) => m.getDispatchConfig(),
    );
    const discovered = await discoverAgents("dispatch");
    const builtinIds = new Set(
      getBuiltinAgents("dispatch").map((agent) => agent.id),
    );
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const resources: Array<{ id: string; path: string; owner: string }> = [];
    for (const prefix of [...REMOTE_AGENT_RESOURCE_PREFIXES].reverse()) {
      resources.push(...(await resourceListAccessible(ownerEmail, prefix)));
    }
    const customById = new Map<
      string,
      {
        resourceId: string;
        path: string;
        scope: "shared" | "personal";
        name: string;
        description: string;
        url: string;
        color: string;
      }
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
      if (!shouldIncludeRemoteAgentManifest(manifest, "dispatch")) continue;
      if (builtinIds.has(manifest.id)) continue;
      customById.set(manifest.id, {
        resourceId: resource.id,
        path: resource.path,
        scope: resource.owner === SHARED_OWNER ? "shared" : "personal",
        name: manifest.name,
        description: manifest.description || "",
        url: manifest.url,
        color: manifest.color || "#6B7280",
      });
    }

    const connected = discovered.map((agent) => {
      const custom = customById.get(agent.id);
      const isBuiltin = builtinIds.has(agent.id);
      return {
        ...agent,
        source: isBuiltin ? "builtin" : custom ? "custom" : "workspace",
        resourceId: custom?.resourceId,
        path: custom?.path,
        scope: custom?.scope,
      };
    });

    const discoveredIds = new Set(connected.map((agent) => agent.id));
    for (const [id, custom] of customById) {
      if (discoveredIds.has(id)) continue;
      connected.push({
        id,
        name: custom.name,
        description: custom.description,
        url: custom.url,
        color: custom.color,
        source: "custom",
        resourceId: custom.resourceId,
        path: custom.path,
        scope: custom.scope,
      });
    }

    return connected.filter((a) => !hiddenAgentIds.includes(a.id));
  },
});
