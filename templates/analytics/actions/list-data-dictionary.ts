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
    "List or browse entries in the data dictionary — the internal catalog of metrics, tables, columns, and business definitions. A focused search also checks the organization's generated source index, whose entries are unapproved metadata suggestions. For an ordinary metric lookup, use find-data instead because it searches definitions and existing dashboard/chart SQL together in one bounded call. Use this action when the user specifically asks to browse dictionary definitions or filter them by department.",
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
    }

    if (q && orgId) {
      const sourceIndex = await readSourceIndex(orgId);
      if (sourceIndex.status === "unavailable") {
        fail(
          "The organization's source index is unreadable. Re-import a valid source index before searching it.",
          {
            errorCode: "source_index_unavailable",
            statusCode: 500,
          },
        );
      }
      if (sourceIndex.status === "invalid") {
        fail(
          "The organization's source index is invalid. Re-import a valid source index before searching it.",
          {
            errorCode: "source_index_invalid",
            statusCode: 500,
          },
        );
      }
      if (sourceIndex.status === "available") {
        const allIndexedMatches = sourceIndexDictionaryEntries(
          sourceIndex.bundle,
        )
          .map((entry) => ({
            entry,
            score: matchSearchFields(q, [
              { value: entry.metric, weight: 28 },
              { value: entry.commonQuestions, weight: 16 },
              { value: entry.definition, weight: 12 },
              { value: entry.table, weight: 8 },
              { value: entry.columnsUsed, weight: 6 },
              { value: entry.source, weight: 5 },
              { value: entry.dependencies, weight: 4 },
              { value: entry.knownGotchas, weight: 2 },
            ]).score,
          }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score);
        for (const { entry } of allIndexedMatches) {
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
