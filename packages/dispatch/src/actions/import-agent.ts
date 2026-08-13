import crypto from "node:crypto";

import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  buildSimpleAgentContent,
  normalizeImportedAgent,
  validateImportedAgentTools,
} from "../lib/simple-agent-profile.js";
import {
  createWorkspaceResource,
  listWorkspaceResources,
} from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Import a Claude-style Markdown agent or a generic JSON agent definition into a reusable Dispatch agent profile. Credentials, shell commands, hooks, and local environment settings are never imported. Use connect-external-agent for an HTTP/A2A endpoint.",
  schema: z.object({
    source: z
      .string()
      .min(1)
      .max(200_000)
      .describe("Pasted Markdown or JSON agent definition"),
    fileName: z
      .string()
      .max(512)
      .optional()
      .describe("Original file name, such as .claude/agents/research.md"),
    scope: z
      .enum(["all", "selected"])
      .default("all")
      .describe("Make the profile available to all apps or selected apps"),
  }),
  run: async ({ source, fileName, scope }) => {
    const normalized = normalizeImportedAgent(source, fileName);
    const { dispatchActions } = await import("./index.js");
    const availableToolNames = new Set([
      ...Object.keys(dispatchActions),
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
    const toolValidation = validateImportedAgentTools(
      normalized.tools,
      availableToolNames,
    );
    const warnings = [...normalized.warnings, ...toolValidation.warnings];
    const sourceHash = crypto.createHash("sha256").update(source).digest("hex");
    const content = buildSimpleAgentContent({
      ...normalized,
      tools: toolValidation.tools,
      source: normalized.source,
      sourcePath: normalized.sourcePath,
      sourceHash,
      importedAt: new Date().toISOString(),
    });
    const path = `agents/${normalized.slug}.md`;
    const existing = (await listWorkspaceResources({ kind: "agent" })).find(
      (resource) => resource.path === path,
    );

    if (existing) {
      if (existing.content.includes(`source-hash: ${sourceHash}`)) {
        return {
          status: "unchanged" as const,
          resource: existing,
          source: normalized.source,
          warnings,
        };
      }
      throw new Error(
        `An agent already exists at ${path}. Rename the source before importing it.`,
      );
    }

    const resource = await createWorkspaceResource({
      kind: "agent",
      name: normalized.name,
      description: normalized.description,
      path,
      content,
      scope,
    });

    return {
      status: "created" as const,
      resource,
      source: normalized.source,
      warnings,
    };
  },
});
