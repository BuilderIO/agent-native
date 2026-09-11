import { z } from "zod";

import { defineAction } from "../../../action.js";
import { embedApp } from "../../../mcp/embed-app.js";
import { SHARED_OWNER } from "../../../resources/store.js";
import {
  buildFrameworkPrompts,
  buildSchemaBlock,
} from "../../../server/agent-chat/framework-prompts.js";
import {
  loadResourcesForPrompt,
  promptResourceManifestSections,
} from "../../../server/agent-chat/prompt-resources.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../../server/request-context.js";
import {
  type ContextPreview,
  type ContextTokenCountMethod,
} from "../../../shared/context-xray.js";
import { buildSystemManifestSections } from "../manifest.js";
import { contextXrayAuthError } from "./errors.js";

function combineMethods(
  left: ContextTokenCountMethod,
  right: ContextTokenCountMethod,
): ContextTokenCountMethod {
  return left === "estimate" || right === "estimate" ? "estimate" : "exact";
}

export async function buildContextPreview(input: {
  ownerEmail: string;
  orgId?: string | null;
  scope: "user" | "org";
  appId?: string;
  compact?: boolean;
  model?: string;
}): Promise<ContextPreview> {
  const compact = input.compact ?? false;
  const prompts = buildFrameworkPrompts();
  const resources = await loadResourcesForPrompt(
    input.scope === "org" ? SHARED_OWNER : input.ownerEmail,
    compact,
    input.appId,
    input.orgId ?? null,
  );
  const schemaBlock = compact
    ? ""
    : await buildSchemaBlock(input.ownerEmail, "read");
  const sections = await buildSystemManifestSections([
    {
      label: "Framework core",
      provenance: "framework-core",
      governance: "required",
      content: compact
        ? prompts.PROD_FRAMEWORK_PROMPT_COMPACT
        : prompts.PROD_FRAMEWORK_PROMPT,
      sourceRef: { scope: "framework" },
    },
    ...promptResourceManifestSections(resources),
    ...(schemaBlock
      ? [
          {
            label: "SQL schema",
            provenance: "db-schema" as const,
            governance: "required" as const,
            content: schemaBlock,
            sourceRef: { scope: "sql" },
          },
        ]
      : []),
  ]);
  const systemTokens = sections.reduce(
    (total, section) => total + section.tokenCount,
    0,
  );
  const tokenCountMethod = sections.reduce(
    (method, section) => combineMethods(method, section.tokenMethod),
    "exact" as ContextTokenCountMethod,
  );
  return {
    computedAt: Date.now(),
    ...(input.model ? { model: input.model } : {}),
    scope: input.scope,
    totalTokens: systemTokens,
    systemTokens,
    tokenCountMethod,
    sections,
    source: "preview",
  };
}

export default defineAction({
  description:
    "Preview the system-prompt context that would be composed for the current user, organization, and app without a live chat thread.",
  schema: z.object({
    scope: z
      .enum(["user", "org"])
      .default("user")
      .describe(
        "Configuration scope to preview: user includes personal context; org includes inherited organization context.",
      ),
    appId: z.string().optional().describe("Current app id, when available."),
    compact: z.boolean().optional().describe("Use the compact startup prompt."),
    model: z.string().optional().describe("Model id for display metadata."),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Context preview",
      description:
        "Preview the system-prompt context before starting a thread.",
      iframeTitle: "Context preview",
      openLabel: "Open context preview",
      height: 720,
    }),
  },
  run: async (args): Promise<ContextPreview> => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw contextXrayAuthError();
    return await buildContextPreview({
      ownerEmail,
      orgId: getRequestOrgId() ?? null,
      scope: args.scope,
      ...(args.appId ? { appId: args.appId } : {}),
      ...(args.compact !== undefined ? { compact: args.compact } : {}),
      ...(args.model ? { model: args.model } : {}),
    });
  },
});
