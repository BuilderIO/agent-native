import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import firstPartyTemplateTrafficSeed from "../../seeds/dashboards/agent-native-templates-first-party.json" with { type: "json" };
import agentObservabilityLlmSeed from "../../seeds/dashboards/agent-observability-llm.json" with { type: "json" };
import googleAnalyticsSeed from "../../seeds/dashboards/google-analytics.json" with { type: "json" };
import nodeExporterFullSeed from "../../seeds/dashboards/node-exporter-full.json" with { type: "json" };
import skillsCliFunnelSeed from "../../seeds/dashboards/skills-cli-funnel.json" with { type: "json" };

const shippedSeeds: Record<string, Record<string, unknown>> = {
  "agent-observability-llm": agentObservabilityLlmSeed as Record<
    string,
    unknown
  >,
  "agent-native-templates-first-party": firstPartyTemplateTrafficSeed as Record<
    string,
    unknown
  >,
  "google-analytics": googleAnalyticsSeed as Record<string, unknown>,
  "node-exporter-full": nodeExporterFullSeed as Record<string, unknown>,
  "skills-cli-funnel": skillsCliFunnelSeed as Record<string, unknown>,
};

function cloneSeed(seed: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(seed)) as Record<string, unknown>;
}

/**
 * Load a shipped dashboard seed JSON. Seeds live in
 * `seeds/dashboards/<id>.json` at the template root and describe the
 * default SqlDashboardConfig we materialize into a user's settings the
 * moment they wire up the underlying data source. Kept as JSON (not TS)
 * so the agent and humans can edit it without touching code.
 *
 * Shipped catalog seeds are statically imported so they survive TS runtimes and
 * production bundles. Filesystem lookup remains as a development escape hatch
 * for locally edited or future non-bundled seeds.
 */
export function loadDashboardSeed(id: string): Record<string, unknown> | null {
  const shipped = shippedSeeds[id];
  if (shipped) return cloneSeed(shipped);

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates: string[] = [];
  // server/lib/ -> template root is two levels up in source/dev.
  candidates.push(
    path.resolve(moduleDir, "..", "..", "seeds", "dashboards", `${id}.json`),
  );
  candidates.push(
    path.resolve(process.cwd(), "seeds", "dashboards", `${id}.json`),
  );
  candidates.push(
    path.resolve(
      process.cwd(),
      "templates",
      "analytics",
      "seeds",
      "dashboards",
      `${id}.json`,
    ),
  );

  for (const file of Array.from(new Set(candidates))) {
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
