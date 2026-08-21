import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
import {
  resourceGetByPath,
  resourcePut,
  sharedResourceOwner,
} from "@agent-native/core/resources/store";
import { z } from "zod";

import {
  currentOrgId,
  currentOwnerEmail,
} from "../server/lib/dispatch-store.js";

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent"
  );
}

async function assertCanManageSharedAgent() {
  const orgId = currentOrgId();
  if (!orgId) return;
  const actor = currentOwnerEmail().trim().toLowerCase();
  const result = await getDbExec().execute({
    sql: "SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1",
    args: [orgId, actor],
  });
  const role = result.rows[0]?.role;
  if (role !== "owner" && role !== "admin") {
    throw new Error(
      "Only organization owners and admins can connect shared agents.",
    );
  }
}

export default defineAction({
  description:
    "Connect an existing HTTP/A2A agent to Dispatch. This stores only its public endpoint and metadata; authentication remains in the normal A2A/MCP connection flow.",
  schema: z.object({
    url: z.string().min(1).describe("HTTP or HTTPS agent endpoint"),
    name: z.string().max(160).optional().describe("Agent name"),
    description: z.string().max(500).optional().describe("Short description"),
    scope: z
      .enum(["shared", "personal"])
      .default("shared")
      .describe("Share with the workspace or keep the connection personal"),
  }),
  run: async ({ url, name, description, scope }) => {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Use an http:// or https:// endpoint URL.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Do not include credentials in the endpoint URL.");
    }

    if (scope === "shared") await assertCanManageSharedAgent();
    const agentName = name?.trim() || parsed.hostname.replace(/^www\./, "");
    const id = slugify(agentName);
    const path = `remote-agents/${id}.json`;
    const owner =
      scope === "shared"
        ? sharedResourceOwner(currentOrgId())
        : currentOwnerEmail();
    const existing = await resourceGetByPath(owner, path);
    if (existing) {
      throw new Error(
        `An external agent already exists at ${path}. Rename it before connecting again.`,
      );
    }

    const manifest = {
      id,
      name: agentName,
      ...(description?.trim() ? { description: description.trim() } : {}),
      url: parsed.toString(),
    };
    const resource = await resourcePut(
      owner,
      path,
      JSON.stringify(manifest, null, 2),
      "application/json",
    );

    return { status: "created" as const, resource, agent: manifest, scope };
  },
});
