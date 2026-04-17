import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";
import { getAllSettings, listOrgSettings } from "@agent-native/core/settings";

const KEY_PREFIX = "data-dict-";

export default defineAction({
  description:
    "List entries in the data dictionary — the internal catalog of metrics, tables, columns, and business definitions the analytics agent should consult before writing SQL or proposing a dashboard. Call this FIRST when the user asks for a dashboard or metric so you know what's already defined, where the numbers come from, and how to query them correctly. Returns all entries sorted by metric name; filter with `search` or `department` when you only need a slice.",
  schema: z.object({
    search: z
      .string()
      .optional()
      .describe(
        "Optional substring to filter entries by metric name or definition (case-insensitive)",
      ),
    department: z
      .string()
      .optional()
      .describe("Optional department filter (e.g. 'Sales', 'Marketing')"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail() || "local@localhost";

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
        const metric = String(e.metric ?? "").toLowerCase();
        const def = String(e.definition ?? "").toLowerCase();
        if (!metric.includes(q) && !def.includes(q)) return false;
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
