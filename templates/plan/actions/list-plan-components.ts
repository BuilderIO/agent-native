import {
  ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
  dataInsightsWidgetResultSchema,
  defineAction,
} from "@agent-native/core";
import { createDataInsightsWidgetResult } from "@agent-native/core/data-widgets";
import { z } from "zod";
import { describePlanBlocksForAgent } from "../shared/plan-block-registry.js";

function normalizeTerms(query: string | undefined): string[] {
  if (!query?.trim()) return [];
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_.:-]+/g)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  );
}

export default defineAction({
  description:
    "List registered Plan visual/chat components from the live block registry, including custom blocks once they are registered in the shared/server and browser registries. Use before generating or pulling diagrams, wireframes, mockups, API specs, data models, tabs, or other visual plan components.",
  schema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Optional component search term such as api, wireframe, mockup.",
      ),
    includeExamples: z
      .preprocess((value) => {
        if (value === "true") return true;
        if (value === "false") return false;
        return value;
      }, z.boolean())
      .optional()
      .default(false)
      .describe("Include per-component examples when available."),
  }),
  outputSchema: dataInsightsWidgetResultSchema,
  chatUI: {
    renderer: ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
    title: "Plan components",
    description: "Render registered Plan block components in chat.",
  },
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: false,
    title: "List Plan Components",
    description:
      "List registered Plan visual components and custom block vocabulary.",
  },
  mcpApp: {
    compactCatalog: true,
  },
  run: async (args) => {
    const terms = normalizeTerms(args.query);
    const blocks = describePlanBlocksForAgent();
    const filtered = blocks.filter((block) => {
      if (terms.length === 0) return true;
      const haystack = [
        block.type,
        block.label,
        block.description,
        block.mdxTag,
        block.placement?.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });

    const rows = filtered.map((block) => ({
      id: block.type,
      type: block.type,
      label: block.label,
      tag: block.mdxTag,
      placement: block.placement.join(", "),
      description: block.description,
    }));

    return createDataInsightsWidgetResult({
      widgetId: "plan.components.v1",
      title: "Plan components",
      summary: {
        query: args.query ?? "",
        count: filtered.length,
        totalRegistered: blocks.length,
      },
      table: {
        title: "Registered components",
        columns: [
          { key: "type", label: "Type" },
          { key: "tag", label: "MDX" },
          { key: "placement", label: "Placement" },
          { key: "description", label: "Use" },
        ],
        rows,
        totalRows: rows.length,
      },
      display: {
        title: `${filtered.length} registered component${
          filtered.length === 1 ? "" : "s"
        }`,
        description:
          "Use get-plan-blocks for full schemas before writing structured content.",
        primaryAction: { label: "Open plans", href: "/plans" },
      },
      components: filtered.map((block) => ({
        type: block.type,
        label: block.label,
        description: block.description,
        placement: block.placement,
        mdxTag: block.mdxTag,
        dataSchema: block.dataSchema,
        ...(args.includeExamples && block.example
          ? { example: block.example }
          : {}),
      })),
      guidance:
        "This list is generated from the same registry used by import/export and the browser renderer. Custom components become chat-visible when they are registered in the normalized schema, shared/server registry, and browser registry.",
    });
  },
});
