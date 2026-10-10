import { defineAction } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import {
  getOrgSetting,
  getUserSetting,
  putOrgSetting,
  putUserSetting,
} from "@agent-native/core/settings";
import { z } from "zod";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import {
  readSourceIndex,
  sourceIndexDictionaryEntries,
} from "../server/lib/source-index-store.js";
import { resolveDictionaryTrustDefaults } from "./data-dictionary-trust.js";
import { cliBoolean } from "./schema-helpers.js";

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
    "Create or update a data dictionary entry — a reusable metric / table / column definition the analytics agent consults before writing SQL. Use this when you discover a new metric worth cataloging, or when the user asks to document / fix an existing one. Upserts by `id` (if omitted, one is derived from `metric`). Org dictionary edits require an organization owner or admin.",
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
    source: z
      .string()
      .optional()
      .describe(
        "Canonical source/provider id for this definition (for example first-party, bigquery, or hubspot)",
      ),
    action: z
      .string()
      .optional()
      .describe(
        "Preferred Analytics action name when this metric is not expressed as SQL",
      ),
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
    approved: cliBoolean
      .optional()
      .describe(
        "Whether this entry has been reviewed and approved. Defaults to false unless explicitly approved.",
      ),
    aiGenerated: cliBoolean
      .optional()
      .describe("True when the agent proposed this entry (vs. human-authored)"),
    status: z
      .enum(["active", "deprecated"])
      .optional()
      .describe(
        "Lifecycle status from list-data-dictionary. Generated index entries use the current source index status; other updates preserve existing status and new entries default to active.",
      ),
    sourceUrl: z
      .string()
      .optional()
      .describe("Optional link to external source of truth (e.g. Notion page)"),
  }),
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    if (orgId) {
      await requireAnalyticsAdminContext({ userEmail: email, orgId });
    }
    const id = args.id?.trim() || slugify(args.metric);
    if (!id) {
      throw new Error(
        "could not derive an id — provide one or a non-empty `metric`.",
      );
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

    let sourceStatus: "active" | "deprecated" | undefined;
    if (orgId && id.startsWith("index-")) {
      const sourceIndex = await readSourceIndex(orgId);
      if (sourceIndex.status === "available") {
        const sourceEntry = sourceIndexDictionaryEntries(
          sourceIndex.bundle,
        ).find((entry) => entry.id === id);
        if (
          sourceEntry?.status === "active" ||
          sourceEntry?.status === "deprecated"
        ) {
          sourceStatus = sourceEntry.status;
        }
      }
    }

    const { approved, aiGenerated } = resolveDictionaryTrustDefaults(
      args,
      existing as { approved?: boolean; aiGenerated?: boolean } | null,
    );

    const entry: Record<string, unknown> = {
      id,
      metric: args.metric,
      definition: args.definition,
      department: args.department ?? (existing as any)?.department ?? "",
      source: args.source ?? (existing as any)?.source ?? "",
      action: args.action ?? (existing as any)?.action ?? "",
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
      approved,
      aiGenerated,
      status:
        sourceStatus ??
        args.status ??
        ((existing as { status?: unknown } | null)?.status === "deprecated"
          ? "deprecated"
          : "active"),
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
