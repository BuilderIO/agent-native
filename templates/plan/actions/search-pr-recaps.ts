import {
  ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
  dataInsightsWidgetResultSchema,
  defineAction,
} from "@agent-native/core";
import { createDataInsightsWidgetResult } from "@agent-native/core/data-widgets";
import { accessFilter, currentAccess } from "@agent-native/core/sharing";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { resolvePlanAccessContext } from "../server/lib/local-identity.js";
import { planPath } from "../server/plans.js";

const queryBooleanSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

const STOP_WORDS = new Set([
  "about",
  "after",
  "all",
  "and",
  "any",
  "ask",
  "change",
  "changed",
  "changes",
  "did",
  "does",
  "for",
  "from",
  "got",
  "have",
  "into",
  "last",
  "like",
  "look",
  "merged",
  "past",
  "prs",
  "pull",
  "request",
  "requests",
  "recap",
  "recaps",
  "ship",
  "shipped",
  "shipping",
  "show",
  "that",
  "the",
  "this",
  "was",
  "week",
  "were",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

function normalizeSearchTerms(query: string | undefined): string[] {
  if (!query?.trim()) return [];
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_.:/-]+/g)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !STOP_WORDS.has(term));
  return Array.from(new Set(terms)).slice(0, 12);
}

function sinceFromDays(days: number | undefined): string {
  const value = Math.max(1, Math.min(days ?? 7, 365));
  return new Date(Date.now() - value * 24 * 60 * 60 * 1000).toISOString();
}

function textIncludesAllTerms(text: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const lower = text.toLowerCase();
  return terms.every((term) => lower.includes(term));
}

function termMatches(text: string, terms: string[]): string[] {
  if (terms.length === 0) return [];
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term));
}

function briefSnippet(value: string | null | undefined): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 140) return normalized;
  return `${normalized.slice(0, 137)}...`;
}

export default defineAction({
  description:
    "Search merged pull request visual recaps for product knowledge. Use this first for questions like what shipped in the last week, when an API changed, what a shipped UI looked like, or what API shape was documented in merged PR recaps. Defaults to merged PR recaps from the last 7 days.",
  schema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Natural-language search query. Generic shipped-last-week wording is treated as a recent merged-PR search.",
      ),
    days: z.coerce
      .number()
      .int()
      .positive()
      .max(365)
      .optional()
      .default(7)
      .describe("Look back this many days from now. Defaults to 7."),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(25)
      .optional()
      .default(8)
      .describe("Maximum recap rows to return. Defaults to 8."),
    mergedOnly: queryBooleanSchema
      .optional()
      .default(true)
      .describe(
        "Only search PR recaps that are known to be merged. Defaults to true.",
      ),
  }),
  outputSchema: dataInsightsWidgetResultSchema,
  chatUI: {
    renderer: ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
    title: "Merged PR recaps",
    description: "Render merged PR recap search results in chat.",
  },
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Search PR Recaps",
    description:
      "Search merged pull request visual recaps for shipped product knowledge.",
  },
  mcpApp: {
    compactCatalog: true,
  },
  run: async (args) => {
    const accessWhere = accessFilter(
      schema.plans,
      schema.planShares,
      resolvePlanAccessContext(currentAccess()),
    );
    const sinceIso = sinceFromDays(args.days);
    const terms = normalizeSearchTerms(args.query);
    const candidateLimit = Math.min(Math.max(args.limit * 8, 50), 200);
    const clauses = [
      accessWhere,
      isNull(schema.plans.deletedAt),
      eq(schema.plans.kind, "recap"),
      or(
        eq(schema.plans.sourceType, "pull-request"),
        sql`${schema.plans.sourceUrl} like ${"%github.com/%/pull/%"}`,
      ),
      sql`coalesce(${schema.plans.sourcePrMergedAt}, ${schema.plans.updatedAt}) >= ${sinceIso}`,
    ];
    if (args.mergedOnly) {
      clauses.push(
        or(
          eq(schema.plans.sourcePrState, "merged"),
          isNotNull(schema.plans.sourcePrMergedAt),
        ),
      );
    }

    const rows = await getDb()
      .select({
        id: schema.plans.id,
        title: schema.plans.title,
        brief: schema.plans.brief,
        repoPath: schema.plans.repoPath,
        currentFocus: schema.plans.currentFocus,
        sourceUrl: schema.plans.sourceUrl,
        sourceType: schema.plans.sourceType,
        sourceRepo: schema.plans.sourceRepo,
        sourcePrNumber: schema.plans.sourcePrNumber,
        sourcePrState: schema.plans.sourcePrState,
        sourcePrMergedAt: schema.plans.sourcePrMergedAt,
        updatedAt: schema.plans.updatedAt,
        bodyPreview: sql<string>`substr(coalesce(${schema.plans.markdown}, ${schema.plans.content}, ${schema.plans.html}, ''), 1, 12000)`,
      })
      .from(schema.plans)
      .where(and(...clauses))
      .orderBy(
        desc(schema.plans.sourcePrMergedAt),
        desc(schema.plans.updatedAt),
      )
      .limit(candidateLimit);

    const results = rows
      .map((row) => {
        const haystack = [
          row.title,
          row.brief,
          row.repoPath,
          row.currentFocus,
          row.sourceUrl,
          row.sourceRepo,
          row.bodyPreview,
        ]
          .filter(Boolean)
          .join("\n");
        const matches = termMatches(haystack, terms);
        return { row, matches };
      })
      .filter(({ row }) => {
        if (terms.length === 0) return true;
        return textIncludesAllTerms(
          [
            row.title,
            row.brief,
            row.repoPath,
            row.currentFocus,
            row.sourceUrl,
            row.sourceRepo,
            row.bodyPreview,
          ]
            .filter(Boolean)
            .join("\n"),
          terms,
        );
      })
      .slice(0, args.limit)
      .map(({ row, matches }) => ({
        id: row.id,
        title: row.title,
        brief: row.brief,
        repo: row.sourceRepo ?? row.repoPath ?? "",
        pr: row.sourcePrNumber ?? "",
        mergedAt: row.sourcePrMergedAt ?? "",
        updatedAt: row.updatedAt,
        sourceUrl: row.sourceUrl ?? "",
        url: planPath(row.id, "recap"),
        matches,
        bodyPreview: briefSnippet(row.bodyPreview),
      }));

    return createDataInsightsWidgetResult({
      widgetId: "plan.prRecapSearch.v1",
      title: "Merged PR recaps",
      summary: {
        query: args.query ?? "",
        days: args.days,
        matched: results.length,
        searched: rows.length,
        mergedOnly: args.mergedOnly,
      },
      table: {
        title: `PR recaps from the last ${args.days} day${
          args.days === 1 ? "" : "s"
        }`,
        columns: [
          { key: "merged", label: "Merged" },
          { key: "pr", label: "PR" },
          { key: "title", label: "Recap" },
          { key: "summary", label: "Summary" },
          { key: "match", label: "Match" },
        ],
        rows: results.map((result) => ({
          id: result.id,
          merged: result.mergedAt
            ? new Date(result.mergedAt).toLocaleDateString()
            : "",
          pr:
            result.repo && result.pr
              ? `${result.repo}#${result.pr}`
              : result.pr,
          title: result.title,
          summary: briefSnippet(result.brief),
          match: result.matches.join(", "),
          href: result.url,
        })),
        totalRows: results.length,
      },
      display: {
        title:
          results.length > 0
            ? `${results.length} merged PR recap${
                results.length === 1 ? "" : "s"
              }`
            : "No merged PR recaps found",
        description:
          results.length > 0
            ? "Open a recap to inspect its diagrams, wireframes, API specs, and code blocks."
            : "Try a wider date range or a more specific product/API term.",
        primaryAction:
          results[0]?.url !== undefined
            ? { label: "Open first recap", href: results[0].url }
            : { label: "Open recaps", href: "/recaps" },
      },
      results,
      guidance:
        "For follow-up API shape, UI appearance, or diagram questions, call get-visual-plan on a matching recap and inspect openapi-spec, api-endpoint, wireframe, diagram, data-model, diff, and annotated-code blocks.",
    });
  },
});
