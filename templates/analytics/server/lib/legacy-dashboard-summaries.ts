import { getDbExec } from "@agent-native/core/db";
import { z } from "zod";

import { BUILTIN_DASHBOARD_IDS } from "../../shared/builtin-dashboard-ids.js";

const legacySummary = z.object({
  id: z.string(),
  kind: z.enum(["sql", "explorer"]),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  orgId: z.string().nullable(),
});

export async function listLegacyDashboardSummaries(
  ctx: { email: string; orgId: string | null },
  options: {
    limit: number;
    search?: string;
    kind?: "sql" | "explorer";
    id?: string;
  },
) {
  const result = await getDbExec().execute({
    sql: `WITH scopes(prefix, kind, org_id, priority) AS (
      VALUES (?::text, 'sql', NULL::text, 1), (?::text, 'explorer', NULL::text, 2),
             (?::text, 'sql', ?::text, 0)
    ), candidates AS (
      SELECT substring(s.key from length(scopes.prefix) + 1) AS id,
        scopes.kind, scopes.org_id, scopes.priority, s.key,
        s.value::jsonb AS metadata
      FROM settings s CROSS JOIN scopes WHERE scopes.prefix IS NOT NULL
        AND left(s.key, length(scopes.prefix)) = scopes.prefix
    ), projected AS (
      SELECT DISTINCT ON (id) id, kind, org_id, metadata,
        coalesce(CASE WHEN jsonb_typeof(metadata->'name') = 'string' THEN metadata->>'name' END,
                 CASE WHEN jsonb_typeof(metadata->'title') = 'string' THEN metadata->>'title' END,
                 id) AS name
      FROM candidates
      WHERE id <> '' AND (kind <> 'explorer' OR id !~* ':|%3a')
        AND NOT (id = ANY(?::text[]))
        AND NOT EXISTS (SELECT 1 FROM dashboards d WHERE d.id = candidates.id)
      ORDER BY id, priority, key
    ) SELECT id, kind, name,
      CASE WHEN jsonb_typeof(metadata->'description') = 'string' THEN left(metadata->>'description', 500) END AS description,
      coalesce(CASE WHEN jsonb_typeof(metadata->'createdAt') = 'string' THEN metadata->>'createdAt' END, '') AS "createdAt",
      coalesce(CASE WHEN jsonb_typeof(metadata->'updatedAt') = 'string' THEN metadata->>'updatedAt' END,
               CASE WHEN jsonb_typeof(metadata->'createdAt') = 'string' THEN metadata->>'createdAt' END, '') AS "updatedAt",
      org_id AS "orgId"
      FROM projected WHERE (?::text IS NULL OR kind = ?)
        AND (?::text IS NULL OR id = ?)
        AND (strpos(lower(name), lower(?)) > 0 OR strpos(lower(id), lower(?)) > 0)
      ORDER BY "updatedAt" DESC, id LIMIT ?`,
    args: [
      ctx.email ? `u:${ctx.email}:sql-dashboard-` : null,
      ctx.email ? `u:${ctx.email}:dashboard-` : null,
      ctx.orgId ? `o:${ctx.orgId}:sql-dashboard-` : null,
      ctx.orgId,
      [...BUILTIN_DASHBOARD_IDS],
      options.kind ?? null,
      options.kind ?? null,
      options.id ?? null,
      options.id ?? null,
      options.search?.trim() ?? "",
      options.search?.trim() ?? "",
      options.limit,
    ],
  });
  return z.array(legacySummary).parse(result.rows);
}
