import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import {
  listOrgSettings,
  listSettingsByPrefix,
} from "@agent-native/core/settings";
import { z } from "zod";

import {
  dataDictionaryTrustRank,
  decodeSearchCursor,
  matchSearchFields,
  paginateSearchResults,
  semanticScopeCompatibility,
  semanticScopeForSearch,
} from "../server/lib/analytics-term-matcher.js";
import {
  readSourceIndex,
  sourceIndexDictionaryEntries,
} from "../server/lib/source-index-store.js";

const KEY_PREFIX = "data-dict-";

export default defineAction({
  description:
    "Browse or search saved dictionary entries and, when configured, unapproved suggestions from the organization's generated source index. Each call returns one page of up to 200 entries and a nextPage cursor when more remain. For an ordinary metric lookup, use find-data because it searches definitions and existing dashboard/chart SQL together in one bounded call.",
  schema: z.object({
    search: z
      .string()
      .optional()
      .describe(
        "Optional ranked search across metric, definition, table, columns, joins, owner, gotchas, and common questions",
      ),
    department: z
      .string()
      .optional()
      .describe("Optional department filter (e.g. 'Sales', 'Marketing')"),
    limit: z.number().int().min(1).max(200).optional().default(50),
    nextPage: z.string().max(64).optional(),
  }),
  http: { method: "GET" },
  mcpTool: true,
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) {
      fail("An authenticated user is required to browse the data dictionary.", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }
    const q = (args.search ?? "").trim();
    const dept = (args.department ?? "").trim().toLowerCase();

    const entries: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    const collect = (raw: unknown) => {
      const e = raw as Record<string, unknown> | null;
      if (!e || typeof e !== "object") return;
      const id = e.id as string | undefined;
      if (!id || seen.has(id)) return;
      seen.add(id);
      entries.push(e);
    };

    if (orgId) {
      const orgEntries = await listOrgSettings(orgId, KEY_PREFIX);
      for (const value of Object.values(orgEntries)) collect(value);
      const sourceIndex = await readSourceIndex(orgId);
      if (sourceIndex.status === "unavailable") {
        fail(
          "The organization's source index is unreadable. Re-import a valid source index before browsing it.",
          {
            errorCode: "source_index_unavailable",
            statusCode: 500,
          },
        );
      }
      if (sourceIndex.status === "invalid") {
        fail(
          "The organization's source index is invalid. Re-import a valid source index before browsing it.",
          {
            errorCode: "source_index_invalid",
            statusCode: 500,
          },
        );
      }
      if (sourceIndex.status === "available") {
        for (const entry of sourceIndexDictionaryEntries(sourceIndex.bundle)) {
          collect(entry);
        }
      }
    }

    // Scope the read in SQL so other users' settings never enter this action.
    const userPrefix = `u:${email}:${KEY_PREFIX}`;
    const userEntries = await listSettingsByPrefix(userPrefix);
    for (const { value } of userEntries) collect(value);

    const requestedScope = semanticScopeForSearch(q);
    const ranked = entries
      .flatMap((e) => {
        if (
          dept &&
          (typeof e.department === "string"
            ? e.department
            : ""
          ).toLowerCase() !== dept
        ) {
          return [];
        }
        const { score, matchedTerms } = q
          ? matchSearchFields(q, [
              { value: e.metric, weight: 28 },
              { value: e.commonQuestions, weight: 16 },
              { value: e.definition, weight: 12 },
              { value: e.table, weight: 8 },
              { value: e.columnsUsed, weight: 6 },
              { value: e.queryTemplate, weight: 5 },
              { value: e.source, weight: 5 },
              { value: e.dependencies, weight: 4 },
              { value: e.action, weight: 5 },
              { value: e.knownGotchas, weight: 2 },
            ])
          : { score: 0, matchedTerms: [] };
        if (q && score <= 0) return [];
        const declaredScope =
          typeof e.semanticScope === "string" && e.semanticScope !== "unknown"
            ? e.semanticScope
            : "";
        const inferredScope = semanticScopeForSearch(
          [e.metric, e.definition, e.source, e.table]
            .filter((value): value is string => typeof value === "string")
            .join(" "),
        );
        const candidateScope = declaredScope || inferredScope;
        const scopeRank = semanticScopeCompatibility(
          candidateScope,
          requestedScope,
        );
        const trustRank = dataDictionaryTrustRank(e);
        return [{ entry: e, score, matchedTerms, scopeRank, trustRank }];
      })
      .sort((a, b) => {
        if (b.trustRank !== a.trustRank) return b.trustRank - a.trustRank;
        if (b.scopeRank !== a.scopeRank) return b.scopeRank - a.scopeRank;
        if (b.score !== a.score) return b.score - a.score;
        return (
          typeof a.entry.metric === "string" ? a.entry.metric : ""
        ).localeCompare(
          typeof b.entry.metric === "string" ? b.entry.metric : "",
        );
      });
    const strongestScopeTrust = Math.max(
      ...ranked
        .filter((result) => result.scopeRank === 2)
        .map((result) => result.trustRank),
      0,
    );
    const scopeFiltered =
      strongestScopeTrust > 0
        ? ranked.filter(
            (result) =>
              result.scopeRank === 2 || result.trustRank > strongestScopeTrust,
          )
        : ranked;
    const cursorSearch = `${q.toLowerCase()}\n${dept}`;
    const page = paginateSearchResults({
      search: cursorSearch,
      results: scopeFiltered.map(({ entry }) => entry),
      searched: entries.length,
      limit: args.limit,
      offset: decodeSearchCursor(cursorSearch, args.nextPage),
    });

    return page;
  },
});
