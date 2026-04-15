import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getOrgSetting,
  getUserSetting,
  putOrgSetting,
  putUserSetting,
} from "@agent-native/core/settings";

const KEY_PREFIX = "data-dict-";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export default defineAction({
  description:
    "Create or update a data dictionary entry — a reusable metric / table / column definition the analytics agent consults before writing SQL. Use this when you discover a new metric worth cataloging, or when the user asks to document / fix an existing one. Upserts by `id` (if omitted, one is derived from `metric`).",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe(
        "URL-safe ID (lowercase, hyphens). If omitted, derived from `metric`.",
      ),
    metric: z.string().describe("Metric / entity name shown in the UI"),
    definition: z
      .string()
      .describe("Plain-English definition of what this metric means"),
    department: z
      .string()
      .optional()
      .describe("Owning team (e.g. 'Sales', 'Marketing', 'Product', 'Data')"),
    table: z
      .string()
      .optional()
      .describe("Source table(s) this metric comes from"),
    columnsUsed: z
      .string()
      .optional()
      .describe("Relevant columns on the source table(s)"),
    cuts: z
      .string()
      .optional()
      .describe("Standard breakdown dimensions (e.g. 'week, channel, geo')"),
    queryTemplate: z
      .string()
      .optional()
      .describe("Canonical SQL snippet that computes this metric"),
    exampleOutput: z
      .string()
      .optional()
      .describe("Sample rows / shape of the result"),
    joinPattern: z
      .string()
      .optional()
      .describe("Typical joins when using this metric alongside others"),
    updateFrequency: z
      .string()
      .optional()
      .describe("How often the underlying data refreshes (hourly/daily/etc)"),
    dataLag: z
      .string()
      .optional()
      .describe("Typical freshness window of the data"),
    dependencies: z
      .string()
      .optional()
      .describe("Upstream pipelines / tables this depends on"),
    validDateRange: z
      .string()
      .optional()
      .describe("Earliest date for which the data is valid"),
    commonQuestions: z
      .string()
      .optional()
      .describe("Questions users frequently ask about this metric"),
    knownGotchas: z
      .string()
      .optional()
      .describe("Pitfalls, caveats, or known data quality issues"),
    exampleUseCase: z
      .string()
      .optional()
      .describe("Example scenario where this metric is used"),
    owner: z
      .string()
      .optional()
      .describe("Person / team responsible for this metric"),
    approved: z
      .boolean()
      .optional()
      .describe("Whether this entry has been reviewed and approved"),
    aiGenerated: z
      .boolean()
      .optional()
      .describe("True when the agent proposed this entry (vs. human-authored)"),
    sourceUrl: z
      .string()
      .optional()
      .describe("Optional link to external source of truth (e.g. Notion page)"),
  }),
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID || null;
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    const id = args.id?.trim() || slugify(args.metric);
    if (!id) {
      return "Error: could not derive an id — provide one or a non-empty `metric`.";
    }
    const key = `${KEY_PREFIX}${id}`;
    const now = new Date().toISOString();

    let existing: Record<string, unknown> | null = null;
    try {
      existing = orgId
        ? await getOrgSetting(orgId, key)
        : await getUserSetting(email, key);
    } catch {
      // not found
    }

    const entry: Record<string, unknown> = {
      id,
      metric: args.metric,
      definition: args.definition,
      department: args.department ?? (existing as any)?.department ?? "",
      table: args.table ?? (existing as any)?.table ?? "",
      columnsUsed: args.columnsUsed ?? (existing as any)?.columnsUsed ?? "",
      cuts: args.cuts ?? (existing as any)?.cuts ?? "",
      queryTemplate:
        args.queryTemplate ?? (existing as any)?.queryTemplate ?? "",
      exampleOutput:
        args.exampleOutput ?? (existing as any)?.exampleOutput ?? "",
      joinPattern: args.joinPattern ?? (existing as any)?.joinPattern ?? "",
      updateFrequency:
        args.updateFrequency ?? (existing as any)?.updateFrequency ?? "",
      dataLag: args.dataLag ?? (existing as any)?.dataLag ?? "",
      dependencies: args.dependencies ?? (existing as any)?.dependencies ?? "",
      validDateRange:
        args.validDateRange ?? (existing as any)?.validDateRange ?? "",
      commonQuestions:
        args.commonQuestions ?? (existing as any)?.commonQuestions ?? "",
      knownGotchas: args.knownGotchas ?? (existing as any)?.knownGotchas ?? "",
      exampleUseCase:
        args.exampleUseCase ?? (existing as any)?.exampleUseCase ?? "",
      owner: args.owner ?? (existing as any)?.owner ?? "",
      approved: args.approved ?? (existing as any)?.approved ?? false,
      aiGenerated: args.aiGenerated ?? (existing as any)?.aiGenerated ?? false,
      sourceUrl: args.sourceUrl ?? (existing as any)?.sourceUrl ?? "",
      createdAt: (existing as any)?.createdAt ?? now,
      updatedAt: now,
      author: email,
    };

    if (orgId) {
      await putOrgSetting(orgId, key, entry);
    } else {
      await putUserSetting(email, key, entry);
    }

    return `Data dictionary entry "${args.metric}" saved as ${id}.`;
  },
});
