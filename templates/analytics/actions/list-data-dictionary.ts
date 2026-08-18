import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { getAllSettings, listOrgSettings } from "@agent-native/core/settings";
import { z } from "zod";

const KEY_PREFIX = "data-dict-";

export default defineAction({
  description:
    "List or browse entries in the data dictionary — the internal catalog of metrics, tables, columns, and business definitions. For an ordinary metric lookup, use search-analytics-query-catalog instead because it searches dictionary entries and existing dashboard/chart SQL together in one bounded call. Use this action when the user specifically asks to browse dictionary definitions or filter them by department.",
  schema: z.object({
    search: z
      .string()
      .optional()
      .describe(
        "Optional substring to filter entries by metric, definition, table, columns, joins, owner, gotchas, or common questions (case-insensitive)",
      ),
    department: z
      .string()
      .optional()
      .describe("Optional department filter (e.g. 'Sales', 'Marketing')"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

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

    // User-scoped entries — iterate once, filter by exact user prefix.
    // See list-analyses.ts for the rationale (substring matches leak across
    // users).
    const userPrefix = `u:${email}:${KEY_PREFIX}`;
    const all = await getAllSettings();
    for (const [fullKey, value] of Object.entries(all)) {
      if (!fullKey.startsWith(userPrefix)) continue;
      collect(value);
    }

    const q = (args.search ?? "").trim().toLowerCase();
    const dept = (args.department ?? "").trim().toLowerCase();
    const filtered = entries.filter((e) => {
      if (q) {
        const searchable = [
          e.metric,
          e.definition,
          e.department,
          e.source,
          e.action,
          e.table,
          e.columnsUsed,
          e.cuts,
          e.queryTemplate,
          e.joinPattern,
          e.updateFrequency,
          e.dataLag,
          e.dependencies,
          e.validDateRange,
          e.commonQuestions,
          e.knownGotchas,
          e.exampleUseCase,
          e.owner,
          e.sourceUrl,
        ]
          .map((value) => String(value ?? "").toLowerCase())
          .join("\n");
        if (!searchable.includes(q)) return false;
      }
      if (dept) {
        if (String(e.department ?? "").toLowerCase() !== dept) return false;
      }
      return true;
    });

    filtered.sort((a, b) =>
      String(a.metric ?? "").localeCompare(String(b.metric ?? "")),
    );

    return filtered;
  },
});
