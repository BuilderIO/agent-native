import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { agentPackRoot } from "../lib/agent-pack.js";
import { listWorkspaceResources } from "../server/lib/workspace-resources-store.js";

const schema = z
  .object({
    agentId: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
  })
  .refine((input) => Boolean(input.agentId || input.path), {
    message: "Provide an agentId or path.",
  });

export default defineAction({
  description:
    "List the files in a reusable agent pack, including its profile, reference files, context files, and agent-owned skills.",
  schema,
  http: { method: "GET" },
  run: async ({ agentId, path }) => {
    const resources = await listWorkspaceResources();
    const profile = resources.find(
      (resource) =>
        resource.kind === "agent" &&
        (agentId ? resource.id === agentId : resource.path === path),
    );
    if (!profile) throw new Error("Agent profile not found");

    const root = agentPackRoot(profile.path.replace(/^agents\//, "").replace(/\.md$/i, ""));
    const files = resources.filter(
      (resource) =>
        resource.id !== profile.id && resource.path.startsWith(`${root}/`),
    );
    return {
      profile,
      root,
      files,
    };
  },
});
