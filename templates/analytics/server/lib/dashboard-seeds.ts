import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Load a shipped dashboard seed JSON. Seeds live in
 * `seeds/dashboards/<id>.json` at the template root and describe the
 * default SqlDashboardConfig we materialize into a user's settings the
 * moment they wire up the underlying data source. Kept as JSON (not TS)
 * so the agent and humans can edit it without touching code.
 *
 * We try `import.meta.dirname` first (accurate in dev) and fall back to
 * `process.cwd()` (the template root when running via Nitro). Matches the
 * pattern used by `server/routes/api/media/[...].get.ts`.
 */
export function loadDashboardSeed(id: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  if (import.meta.dirname) {
    // server/lib/ -> template root is two levels up
    candidates.push(
      path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "seeds",
        "dashboards",
        `${id}.json`,
      ),
    );
  }
  candidates.push(
    path.resolve(process.cwd(), "seeds", "dashboards", `${id}.json`),
  );

  for (const file of candidates) {
    try {
      const raw = readFileSync(file, "utf-8");
      return JSON.parse(raw);
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.warn(
          `[dashboard-seeds] failed to load seed ${id} from ${file}:`,
          err?.message ?? err,
        );
      }
    }
  }
  return null;
}
