/** Search dictation history by its native or cleaned transcript text. */

import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { buildCaseInsensitiveSearchPattern } from "./search-recordings-utils.js";

const SNIPPET_RADIUS = 80;

function buildSnippet(text: string, query: string): string | null {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return null;
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + query.length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

export default defineAction({
  description:
    "Search dictations by their native or cleaned transcript text. Results are scoped to dictations the current user can access and include a short matching snippet.",
  schema: z.object({
    query: z.string().min(1).describe("Search text"),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const pattern = buildCaseInsensitiveSearchPattern(args.query);
    const rows = await db
      .select({
        id: schema.dictations.id,
        fullText: schema.dictations.fullText,
        cleanedText: schema.dictations.cleanedText,
        durationMs: schema.dictations.durationMs,
        source: schema.dictations.source,
        targetApp: schema.dictations.targetApp,
        startedAt: schema.dictations.startedAt,
        createdAt: schema.dictations.createdAt,
      })
      .from(schema.dictations)
      .where(
        and(
          accessFilter(schema.dictations, schema.dictationShares),
          sql`(lower(${schema.dictations.fullText}) LIKE ${pattern} ESCAPE '\\' OR lower(coalesce(${schema.dictations.cleanedText}, '')) LIKE ${pattern} ESCAPE '\\')`,
        ),
      )
      .orderBy(desc(schema.dictations.startedAt))
      .limit(args.limit);

    return {
      query: args.query,
      dictations: rows.map((dictation) => ({
        ...dictation,
        snippet:
          buildSnippet(dictation.cleanedText ?? "", args.query) ??
          buildSnippet(dictation.fullText, args.query),
      })),
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const dictations = (result as { dictations?: unknown }).dictations;
    if (!Array.isArray(dictations) || dictations.length === 0) return null;
    const first = dictations[0] as { id?: string };
    if (!first.id) return null;
    return {
      url: buildDeepLink({
        app: "clips",
        view: "dictate",
        params: { dictationId: first.id },
        to: "/dictate",
      }),
      label: "Open Dictate in Clips",
      view: "dictate",
    };
  },
});
