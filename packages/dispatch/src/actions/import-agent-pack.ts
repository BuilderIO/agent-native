import crypto from "node:crypto";

import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  AGENT_PACK_MAX_FILE_BYTES,
  AGENT_PACK_MAX_FILES,
  agentPackProfileContent,
  agentPackRoot,
  normalizeAgentPack,
  type AgentPackFileInput,
} from "../lib/agent-pack.js";
import { validateImportedAgentTools } from "../lib/simple-agent-profile.js";
import { applyAgentPackCreate } from "../server/lib/agent-pack-store.js";
import {
  createApprovalRequest,
  getApprovalPolicy,
} from "../server/lib/dispatch-store.js";
import {
  listWorkspaceResources,
  type WorkspaceResourceInput,
} from "../server/lib/workspace-resources-store.js";

const packFileSchema = z.object({
  path: z.string().trim().min(1).max(240),
  content: z.string().max(AGENT_PACK_MAX_FILE_BYTES),
});

const schema = z.object({
  files: z
    .array(packFileSchema)
    .min(1)
    .max(AGENT_PACK_MAX_FILES)
    .describe("Text files from an agent folder, including its profile"),
  scope: z
    .enum(["all", "selected"])
    .default("all")
    .describe("Make the pack available to all apps or selected apps"),
});

function availableToolNames(dispatchToolNames: string[]): Set<string> {
  return new Set([
    ...dispatchToolNames,
    "agent-teams",
    "bash",
    "call-agent",
    "db-query",
    "db-schema",
    "refresh-screen",
    "resources",
    "set-search-params",
    "set-url-path",
    "tool-search",
    "web-request",
    "web-search",
  ]);
}

export default defineAction({
  description:
    "Import a folder-backed agent pack from Claude, Cowork, or another agent tool. The pack can include a Markdown/JSON profile, context, references, and skills. Credentials, hooks, shell commands, and local environment settings are never imported.",
  schema,
  run: async ({ files, scope }) => {
    const normalized = normalizeAgentPack(files as AgentPackFileInput[]);
    const { dispatchActions } = await import("./index.js");
    const toolValidation = validateImportedAgentTools(
      normalized.profile.tools,
      availableToolNames(Object.keys(dispatchActions)),
    );
    const warnings = [...normalized.warnings, ...toolValidation.warnings];
    const sourceHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(files))
      .digest("hex");
    const profileContent = agentPackProfileContent({
      profile: normalized.profile,
      tools: toolValidation.tools,
      sourceHash,
      importedAt: new Date().toISOString(),
    });
    const root = agentPackRoot(normalized.profile.slug);
    const inputs: WorkspaceResourceInput[] = [
      {
        kind: "agent",
        name: normalized.profile.name,
        description: normalized.profile.description,
        path: `${root}.md`,
        content: profileContent,
        scope,
      },
      ...normalized.files.map((file) => ({
        kind: file.kind,
        name: file.name,
        description: file.description,
        path: `${root}/${file.path}`,
        content: file.content,
        scope,
      })),
    ];
    const existing = await listWorkspaceResources();
    const existingProfile = existing.find(
      (resource) => resource.path === `${root}.md`,
    );
    if (existingProfile?.content.includes(`source-hash: ${sourceHash}`)) {
      return {
        status: "unchanged" as const,
        resource: existingProfile,
        files: existing.filter((resource) =>
          resource.path.startsWith(`${root}/`),
        ),
        warnings,
      };
    }
    if (existingProfile) {
      throw new Error(
        `An agent already exists at ${root}. Rename the source before importing it.`,
      );
    }

    const policy = await getApprovalPolicy();
    if (scope === "all" && policy.enabled) {
      const approval = await createApprovalRequest({
        changeType: "workspace-agent-pack.create",
        targetType: "workspace-agent-pack",
        summary: `Import All-app agent pack "${normalized.profile.name}"`,
        payload: { inputs },
        beforeValue: null,
        afterValue: {
          name: normalized.profile.name,
          path: `${root}.md`,
          fileCount: inputs.length,
        },
      });
      return { status: "pending-approval" as const, approval, warnings };
    }

    const created = await applyAgentPackCreate(inputs);
    return {
      status: "created" as const,
      resource: created[0] ?? null,
      files: created.slice(1),
      warnings,
    };
  },
});
