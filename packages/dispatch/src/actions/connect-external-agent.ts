import { defineAction } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import {
  resourceGetByPath,
  resourcePut,
  sharedResourceOwner,
} from "@agent-native/core/resources/store";
import { z } from "zod";

import {
  AGENT_IMPORT_ERROR_CODES,
  failAgentImport,
} from "../lib/agent-import-errors.js";
import {
  currentOrgId,
  currentOwnerEmail,
} from "../server/lib/dispatch-store.js";

function parseAgentEndpointUrl(value: string): URL {
  try {
    return new URL(value.trim());
  } catch {
    failAgentImport(
      "Enter a valid http:// or https:// endpoint URL.",
      AGENT_IMPORT_ERROR_CODES.inputInvalid,
    );
  }
}

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
    const parsed = parseAgentEndpointUrl(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      failAgentImport(
        "Use an http:// or https:// endpoint URL.",
        AGENT_IMPORT_ERROR_CODES.inputInvalid,
      );
    }
    if (parsed.username || parsed.password) {
      failAgentImport(
        "Do not include credentials in the endpoint URL.",
        AGENT_IMPORT_ERROR_CODES.inputInvalid,
      );
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
      failAgentImport(
        `An external agent already exists at ${path}. Rename it before connecting again.`,
        AGENT_IMPORT_ERROR_CODES.duplicate,
        { statusCode: 409 },
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
