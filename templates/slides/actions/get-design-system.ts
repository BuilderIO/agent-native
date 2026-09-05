import { defineAction } from "@agent-native/core/action";
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
const MAX_SUMMARY_CONTEXT_CHARS = 1_500;
const MAX_SUMMARY_TOKEN_VALUES = 16;
const MAX_SUMMARY_INSTRUCTIONS_CHARS = 600;

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

function formatTokenValues(
  tokenValues: Record<string, string>,
  limit = MAX_TOKEN_VALUES,
): string[] {
  const entries = Object.entries(tokenValues)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .slice(0, limit);
  if (entries.length === 0) return [];
  return [
    "Builder DSI token values to apply first:",
    ...entries.map(([name, value]) => `- ${name}: ${value}`),
  ];
}

/**
 * A locally-stored kit has no flat token record like Builder's `tokenValues`
 * — it's grouped one level deep (colors.primary, typography.headingFont).
 * Flatten it to the same `name: value` shape so the compact summary can
 * reuse `formatTokenValues` instead of dumping the whole JSON blob.
 */
function flattenLocalTokenValues(data: unknown): Record<string, string> {
  const flat: Record<string, string> = {};
  if (!data || typeof data !== "object") return flat;
  for (const [group, groupValue] of Object.entries(
    data as Record<string, unknown>,
  )) {
    if (!groupValue || typeof groupValue !== "object") continue;
    for (const [key, value] of Object.entries(
      groupValue as Record<string, unknown>,
    )) {
      if (typeof value === "string" && value.trim()) {
        flat[`${group}.${key}`] = value;
      }
    }
  }
  return flat;
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

/**
 * Bounded, network-free summary for the reads that fire on every chat turn
 * (view-screen, get-deck). No Builder docs fetch and no data/assets blobs —
 * just enough to keep going until the caller needs the full context.
 */
function buildCompactDesignSystemAgentContext({
  id,
  title,
  description,
  data,
  customInstructions,
  builderDesignSystemId,
}: {
  id: string;
  title: string;
  description?: string | null;
  data?: string | null;
  customInstructions?: string | null;
  builderDesignSystemId: string | null;
}): string {
  const lines: string[] = [
    "## Selected Design System Context (summary)",
    `Use "${title}" (id: ${id}) as the visual source of truth for this deck.`,
  ];

  if (description?.trim()) {
    lines.push("", "Description:", description.trim());
  }

  if (customInstructions?.trim()) {
    lines.push(
      "",
      "Custom instructions:",
      truncate(customInstructions.trim(), MAX_SUMMARY_INSTRUCTIONS_CHARS),
    );
  }

  if (builderDesignSystemId) {
    lines.push(
      "",
      `Builder-linked design system (builderDesignSystemId=${builderDesignSystemId}): token values and docs are returned only by get-design-system { id } without compact.`,
    );
  } else {
    lines.push(
      "",
      ...formatTokenValues(
        flattenLocalTokenValues(parseJson(data)),
        MAX_SUMMARY_TOKEN_VALUES,
      ),
    );
  }

  return truncate(lines.filter(Boolean).join("\n"), MAX_SUMMARY_CONTEXT_CHARS);
}

export default defineAction({
  description:
    "Get a design system by ID. Returns the full design system (colors, typography, spacing, assets, Builder docs) and its agentContext for generation; call it once before the first slide or screen you author and reuse it for every later write. compact='true' returns only the bounded summary that deck and design reads already include.",
  schema: z.object({
    id: z.string().describe("Design system ID"),
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "'true' returns a bounded, network-free summary: no Builder docs fetch, agentContext capped at 1,500 chars, no data/assets blobs. Omit for the full context you need before authoring.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id, compact }) => {
    const access = await resolveAccess("design-system", id);
    if (!access) {
      throw Object.assign(new Error("Design system not found"), {
        statusCode: 404,
      });
    }

    const row = access.resource;
    const builderReference = parseBuilderDesignSystemProxyReference(row.data);

    if (compact === "true") {
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        builderDesignSystemId: builderReference?.builderDesignSystemId ?? null,
        agentContext: buildCompactDesignSystemAgentContext({
          id: row.id,
          title: row.title,
          description: row.description,
          data: row.data,
          customInstructions: row.customInstructions,
          builderDesignSystemId:
            builderReference?.builderDesignSystemId ?? null,
        }),
      };
    }

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
