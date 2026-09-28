import { defineAction, fail } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import {
  resourcePutIfAbsent,
  sharedResourceOwner,
} from "@agent-native/core/resources/store";
import { z } from "zod";

import { parseAgentEndpointUrl } from "../lib/agent-endpoint-url.js";
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
    sql: `SELECT role FROM org_members
          WHERE org_id = ? AND LOWER(email) = ?
            AND federation_removal_pending_at IS NULL
          LIMIT 1`,
    args: [orgId, actor],
  });
  const role = result.rows[0]?.role;
  if (role !== "owner" && role !== "admin") {
    fail("Only organization owners and admins can connect shared agents.", {
      statusCode: 403,
    });
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
    let parsed: URL;
    try {
      parsed = parseAgentEndpointUrl(url);
    } catch (err) {
      fail(err instanceof Error ? err.message : "Enter a valid URL.");
    }

    if (scope === "shared") await assertCanManageSharedAgent();
    const agentName = name?.trim() || parsed.hostname.replace(/^www\./, "");
    const id = slugify(agentName);
    const path = `remote-agents/${id}.json`;
    const owner =
      scope === "shared"
        ? sharedResourceOwner(currentOrgId())
        : currentOwnerEmail();

    const manifest = {
      id,
      name: agentName,
      ...(description?.trim() ? { description: description.trim() } : {}),
      url: parsed.toString(),
    };
    const resource = await resourcePutIfAbsent(
      owner,
      path,
      JSON.stringify(manifest, null, 2),
      "application/json",
    );
    if (!resource) {
      fail(
        `An external agent already exists at ${path}. Rename it before connecting again.`,
        { statusCode: 409 },
      );
    }

    return { status: "created" as const, resource, agent: manifest, scope };
  },
});
