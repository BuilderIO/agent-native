import { defineAction } from "@agent-native/core";
import {
  hydrateBuilderDesignSystemReference,
  parseBuilderDesignSystemProxyReference,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs

const MAX_AGENT_CONTEXT_CHARS = 14_000;
const MAX_JSON_CONTEXT_CHARS = 2_500;
const MAX_BUILDER_DOCS = 8;
const MAX_BUILDER_DOC_CHARS = 1_200;
const MAX_TOKEN_VALUES = 48;

interface BuilderGenerationContext {
  builderDesignSystemId: string;
  builderJobId: string;
  builderProjectId?: string;
  builderUrl?: string;
  builderStatus?: string;
  docs: Array<{
    name?: string;
    type?: string;
    description?: string;
    content?: string;
    tokenValues?: Record<string, string>;
  }>;
  tokenValues: Record<string, string>;
  docCount: number;
  warning?: string;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trimEnd()}\n[truncated]`;
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatJson(value: unknown, maxChars = MAX_JSON_CONTEXT_CHARS): string {
  return truncate(JSON.stringify(value, null, 2), maxChars);
}

function formatTokenValues(tokenValues: Record<string, string>): string[] {
  const entries = Object.entries(tokenValues)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .slice(0, MAX_TOKEN_VALUES);
  if (entries.length === 0) return [];
  return [
    "Builder DSI token values to apply first:",
    ...entries.map(([name, value]) => `- ${name}: ${value}`),
  ];
}

function buildDesignSystemAgentContext({
  id,
  title,
  description,
  data,
  assets,
  customInstructions,
  builder,
}: {
  id: string;
  title: string;
  description?: string | null;
  data?: string | null;
  assets?: string | null;
  customInstructions?: string | null;
  builder: BuilderGenerationContext | null;
}): string {
  const lines: string[] = [
    "## Selected Design System Context",
    `Use "${title}" (id: ${id}) as the visual source of truth for this deck.`,
    "Apply these tokens, assets, and usage notes before choosing colors, type, spacing, radius, imagery, slide defaults, or component language.",
  ];

  if (description?.trim()) {
    lines.push("", "Description:", description.trim());
  }

  if (customInstructions?.trim()) {
    lines.push("", "Custom instructions:", customInstructions.trim());
  }

  const parsedAssets = parseJson(assets);
  if (Array.isArray(parsedAssets) && parsedAssets.length > 0) {
    lines.push("", "Design system assets:", formatJson(parsedAssets));
  }

  if (builder) {
    lines.push(
      "",
      "Builder DSI:",
      `- Design system id: ${builder.builderDesignSystemId}`,
      `- Job id: ${builder.builderJobId}`,
      builder.builderProjectId
        ? `- Project id: ${builder.builderProjectId}`
        : "",
      builder.builderUrl ? `- URL: ${builder.builderUrl}` : "",
      builder.builderStatus ? `- Status: ${builder.builderStatus}` : "",
      "- Builder DSI docs and token values override local proxy placeholders.",
      "- Do not substitute a generic style if DSI docs or tokens are unavailable; call get-design-system again or tell the user Builder indexing is not ready.",
    );

    if (builder.warning) {
      lines.push(`- Warning: ${builder.warning}`);
    }

    lines.push("", ...formatTokenValues(builder.tokenValues));

    const docs = builder.docs.slice(0, MAX_BUILDER_DOCS);
    if (docs.length > 0) {
      lines.push("", "Builder DSI docs to follow:");
      for (const doc of docs) {
        const label = [doc.name, doc.type ? `(${doc.type})` : ""]
          .filter(Boolean)
          .join(" ");
        lines.push(
          "",
          `### ${label || "Design system doc"}`,
          doc.description?.trim() ? doc.description.trim() : "",
          doc.content?.trim()
            ? truncate(doc.content.trim(), MAX_BUILDER_DOC_CHARS)
            : "",
        );
      }
    }
  } else {
    const parsedData = parseJson(data);
    if (parsedData) {
      lines.push("", "Local design-system tokens:", formatJson(parsedData));
    }
  }

  return truncate(lines.filter(Boolean).join("\n"), MAX_AGENT_CONTEXT_CHARS);
}

export default defineAction({
  description:
    "Get a design system by ID. Returns full design system data including colors, typography, spacing, assets, and a compact agentContext for generation.",
  schema: z.object({
    id: z.string().describe("Design system ID"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }) => {
    const access = await resolveAccess("design-system", id);
    if (!access) {
      throw new Error("Design system not found");
    }

    const row = access.resource;
    const builderReference = parseBuilderDesignSystemProxyReference(row.data);
    const builder = builderReference
      ? await hydrateBuilderDesignSystemReference(builderReference).catch(
          (error) => ({
            ...builderReference,
            docs: [],
            tokenValues: {},
            docCount: 0,
            warning:
              error instanceof Error
                ? error.message
                : "Builder design-system docs could not be loaded.",
          }),
        )
      : null;

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      data: row.data ?? null,
      assets: row.assets ?? null,
      customInstructions: row.customInstructions ?? "",
      isDefault: row.isDefault,
      visibility: row.visibility,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      builder,
      agentContext: buildDesignSystemAgentContext({
        id: row.id,
        title: row.title,
        description: row.description,
        data: row.data,
        assets: row.assets,
        customInstructions: row.customInstructions,
        builder,
      }),
    };
  },
});
