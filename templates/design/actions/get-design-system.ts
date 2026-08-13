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
// Per-section budgets for a locally-stored kit. These exist because one shared
// JSON dump starves whatever `JSON.stringify` happens to order last — which was
// `notes` and `customCSS`, the only carriers of component, shadow, and motion
// detail a rich import produces. Sectioning them means a 500-token kit loses
// tail tokens instead of losing its entire component vocabulary.
const MAX_NAMED_TOKENS = 220;
const MAX_CUSTOM_CSS_CHARS = 3_000;
const MAX_NOTES_CHARS = 3_000;
const MAX_CORE_TOKEN_JSON_CHARS = 2_000;

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

/**
 * The source system's own token names. A kit that renders as seven color roles
 * reads as "a few colors" no matter how much was imported — these names are the
 * difference between the user's design system and a palette that resembles it.
 */
function formatNamedTokens(tokens: unknown): string[] {
  if (!Array.isArray(tokens)) return [];
  const usable = tokens.filter(
    (token): token is Record<string, string> =>
      Boolean(token) &&
      typeof token === "object" &&
      typeof (token as { name?: unknown }).name === "string" &&
      typeof (token as { value?: unknown }).value === "string",
  );
  if (usable.length === 0) return [];
  const shown = usable.slice(0, MAX_NAMED_TOKENS);
  const lines = [
    `Named tokens from the source system (${usable.length} total).`,
    "These are the design team's own names. Use them verbatim as CSS custom " +
      "properties instead of inventing generic ones:",
    ...shown.map((token) => {
      const cssVar = token.cssVar ? ` (${token.cssVar})` : "";
      const group = token.group ? ` [${token.group}]` : "";
      const type = token.type ? ` {${token.type}}` : "";
      return `- ${token.name}${cssVar}: ${token.value}${type}${group}`;
    }),
  ];
  if (shown.length < usable.length) {
    lines.push(
      `- [${usable.length - shown.length} further tokens stored but not listed here; ` +
        "they exist in the kit — do not treat this list as the complete system]",
    );
  }
  return lines;
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
    `Use "${title}" (id: ${id}) as the visual source of truth for this generation.`,
    "Apply these tokens, assets, and usage notes before choosing colors, type, spacing, radius, imagery, or component language.",
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
  }

  // Builder hydration can succeed as a request and still carry nothing usable
  // (a failed/incomplete index returns zero docs and zero token values). The
  // stored local kit is then the only real content there is, so emit it rather
  // than presenting placeholder proxy values as if they were the user's brand.
  const builderUsable = Boolean(
    builder &&
    (builder.docCount > 0 || Object.keys(builder.tokenValues).length > 0),
  );
  if (builder && !builderUsable) {
    lines.push(
      "",
      "- Builder returned no usable docs or token values for this system. " +
        "Anything below comes from the locally stored kit; if that is also " +
        "thin, say so and ask the user to finish indexing rather than " +
        "filling the gap with a generic style.",
    );
  }

  if (!builder || !builderUsable) {
    const parsedData = parseJson(data) as Record<string, unknown> | null;
    if (parsedData) {
      const { tokens, customCSS, notes, ...coreTokens } = parsedData as {
        tokens?: unknown;
        customCSS?: unknown;
        notes?: unknown;
      } & Record<string, unknown>;

      if (Object.keys(coreTokens).length > 0) {
        lines.push(
          "",
          "Core design-system tokens:",
          formatJson(coreTokens, MAX_CORE_TOKEN_JSON_CHARS),
        );
      }

      const namedTokens = formatNamedTokens(tokens);
      if (namedTokens.length > 0) {
        lines.push("", ...namedTokens);
      }

      if (typeof customCSS === "string" && customCSS.trim()) {
        lines.push(
          "",
          "Design-system CSS to place in the generated document's `:root` " +
            "(use these declarations directly; do not re-derive them):",
          truncate(customCSS.trim(), MAX_CUSTOM_CSS_CHARS),
        );
      }

      if (typeof notes === "string" && notes.trim()) {
        lines.push(
          "",
          "Design-system notes — component, elevation, motion, and usage " +
            "detail captured at import. Follow these as rules, not trivia:",
          truncate(notes.trim(), MAX_NOTES_CHARS),
        );
      }
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
      throw Object.assign(new Error("Design system not found"), {
        statusCode: 404,
      });
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
