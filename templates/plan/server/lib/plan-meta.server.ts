/**
 * Minimal server-side plan metadata fetcher for route meta tags.
 *
 * Deliberately SHALLOW: imports only getDb + schema (Drizzle) — no plan-content
 * parsers, no h3, no browser-only deps — so this file stays safe in the Nitro
 * server bundle and cannot drag in excalidraw/mermaid or other SSR-hostile libs.
 *
 * Privacy contract: only expose title/brief when visibility === "public".
 * Private or missing plans return null so the route falls back to generic meta;
 * a private plan title must never appear in SSR HTML for unauthenticated fetchers
 * (link-unfurl bots are unauthenticated).
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";

export type PublicPlanMeta = {
  title: string;
  brief: string;
  kind: string;
};

/**
 * Fetch the minimal plan data needed to render per-plan meta tags.
 *
 * Returns `null` when:
 *   - the plan does not exist
 *   - the plan's visibility is not "public"
 *
 * Never throws — callers fall back to generic meta on null.
 */
export async function fetchPublicPlanMeta(
  id: string,
): Promise<PublicPlanMeta | null> {
  try {
    const [row] = await getDb()
      .select({
        title: schema.plans.title,
        brief: schema.plans.brief,
        visibility: schema.plans.visibility,
        kind: schema.plans.kind,
      })
      .from(schema.plans)
      .where(eq(schema.plans.id, id))
      .limit(1);

    if (!row || row.visibility !== "public") return null;

    return {
      title: row.title,
      brief: row.brief,
      kind: row.kind ?? "plan",
    };
  } catch {
    return null;
  }
}
