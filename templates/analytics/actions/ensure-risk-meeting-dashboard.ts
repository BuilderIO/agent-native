import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineAction, embedApp } from "@agent-native/core";
import { upsertDataProgram } from "@agent-native/core/data-programs";
import {
  buildDeepLink,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getDashboard, upsertDashboard } from "../server/lib/dashboards-store";

const APP_ID = "analytics";
const DASHBOARD_ID = "risk-meeting";
const DASHBOARD_TITLE = "Risk Meeting";
const REFRESH_MODE = "ttl" as const;
const REFRESH_TTL_MS = 900_000; // 15 minutes.

const COHORT_PROGRAM_NAME = "risk-meeting-cohort";
const EARLY_WARNING_PROGRAM_NAME = "risk-meeting-pylon-early-warning";

interface ProgramSeedDef {
  name: string;
  title: string;
  description: string;
  filename: string;
}

const PROGRAM_SEEDS: ProgramSeedDef[] = [
  {
    name: COHORT_PROGRAM_NAME,
    title: "Risk Meeting — HubSpot cohort",
    description:
      "HubSpot deals in the Risk Meeting risk_status cohort, joined to Pylon " +
      "account sentiment by company domain. Worked example of the generic " +
      "provider-access pattern: deal-property IN-search + batched " +
      "association/company lookups + a cross-provider join, entirely inside " +
      "one stored data program (no bespoke vendor action).",
    filename: "risk-meeting-cohort.js",
  },
  {
    name: EARLY_WARNING_PROGRAM_NAME,
    title: "Risk Meeting — Pylon early warning",
    description:
      "Enterprise Pylon accounts with at-risk support sentiment that have " +
      "NOT yet appeared in the HubSpot risk cohort — support signal outrunning " +
      "CRM signal. Demonstrates excluding one provider's cohort from another's " +
      "inside a single data program.",
    filename: "risk-meeting-pylon-early-warning.js",
  },
];

// ---------------------------------------------------------------------------
// Seed code loading.
//
// Mirrors the `loadDashboardSeed` pattern in `../server/lib/dashboard-seeds.ts`:
// resolve a handful of candidate on-disk paths relative to this module and to
// the process cwd, so the same lookup works in local dev, `pnpm action`, and
// bundled/serverless builds where the template root may be laid out
// differently. Unlike JSON dashboard seeds, these are stored as raw JS text —
// see the comment atop each seed file for why `.js` under `seeds/` is the
// stored-program payload format, not a build source file.
// ---------------------------------------------------------------------------

const seedCodeCache = new Map<string, string>();

function loadProgramCode(filename: string): string {
  const cached = seedCodeCache.get(filename);
  if (cached !== undefined) return cached;

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = Array.from(
    new Set([
      // actions/ -> template root is one level up in source/dev.
      path.resolve(moduleDir, "..", "seeds", "data-programs", filename),
      path.resolve(process.cwd(), "seeds", "data-programs", filename),
      path.resolve(
        process.cwd(),
        "templates",
        "analytics",
        "seeds",
        "data-programs",
        filename,
      ),
    ]),
  );

  for (const file of candidates) {
    try {
      const code = readFileSync(file, "utf-8");
      seedCodeCache.set(filename, code);
      return code;
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.warn(
          `[ensure-risk-meeting-dashboard] failed to read seed ${filename} from ${file}:`,
          err?.message ?? err,
        );
      }
    }
  }

  throw new Error(
    `Risk Meeting data-program seed "${filename}" not found. Looked in: ${candidates.join(", ")}`,
  );
}

function programPanel(id: string, title: string, programId: string) {
  return {
    id,
    title,
    source: "program",
    chartType: "table",
    width: 2,
    sql: JSON.stringify({ programId }),
  };
}

interface EnsureCtx {
  email: string;
  orgId: string | null;
}

export interface EnsureRiskMeetingDashboardResult {
  dashboardId: string;
  programIds: Record<string, string>;
  created: boolean;
}

/**
 * Idempotent installer: upserts the two Risk Meeting data programs (keyed by
 * stable `name`, so re-running updates the same rows instead of duplicating
 * them) and a two-panel "Risk Meeting" dashboard that binds each panel to its
 * program via the `"program"` panel source. Programs and the dashboard are
 * created under the CALLER's ownership — no credentials are required at
 * install time; HubSpot/Pylon auth resolves per-viewer the first time a panel
 * (or an agent `run-data-program` call) actually executes the program.
 */
export async function ensureRiskMeetingDashboard(
  ctx: EnsureCtx,
): Promise<EnsureRiskMeetingDashboardResult> {
  if (!ctx.email) throw new Error("no authenticated user");

  const programIds: Record<string, string> = {};
  for (const seed of PROGRAM_SEEDS) {
    const code = loadProgramCode(seed.filename);
    const program = await upsertDataProgram({
      appId: APP_ID,
      name: seed.name,
      title: seed.title,
      description: seed.description,
      code,
      refreshMode: REFRESH_MODE,
      refreshTtlMs: REFRESH_TTL_MS,
      background: false,
      ownerEmail: ctx.email,
      orgId: ctx.orgId ?? null,
    });
    programIds[seed.name] = program.id;
  }

  const existing = await getDashboard(DASHBOARD_ID, {
    email: ctx.email,
    orgId: ctx.orgId ?? null,
  });

  const config = {
    name: DASHBOARD_TITLE,
    description:
      "HubSpot deal-property risk cohort joined with Pylon account sentiment, " +
      "plus Pylon-only early-warning accounts not yet in the HubSpot cohort. " +
      "Both panels are bound to stored data programs — see the data-programs " +
      "skill for how the underlying join works.",
    panels: [
      programPanel(
        "risk-meeting-cohort-panel",
        "Risk Meeting Cohort (HubSpot x Pylon)",
        programIds[COHORT_PROGRAM_NAME],
      ),
      programPanel(
        "risk-meeting-early-warning-panel",
        "Pylon Early Warning (not yet in HubSpot cohort)",
        programIds[EARLY_WARNING_PROGRAM_NAME],
      ),
    ],
  };

  await upsertDashboard(DASHBOARD_ID, "sql", config, {
    email: ctx.email,
    orgId: ctx.orgId ?? null,
  });

  return {
    dashboardId: DASHBOARD_ID,
    programIds,
    created: !existing,
  };
}

export default defineAction({
  description:
    "Install (or update, idempotently) the Risk Meeting dashboard: a worked example of the " +
    "generic provider-access pattern combining a HubSpot deal-property risk cohort (arbitrary " +
    "property IN-search), a HubSpot deal -> company -> domain join, and a Pylon account " +
    "sentiment join, entirely inside two stored data programs with zero vendor-specific action " +
    "code. Safe to re-run: upserts the same data programs by name and the same dashboard by id. " +
    "Creation succeeds without HubSpot/Pylon credentials configured — provider auth resolves " +
    "per-viewer only when a panel or run-data-program call actually executes a program.",
  schema: z.object({}),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Risk Meeting dashboard",
      description: "Open the installed Risk Meeting dashboard in Analytics.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open Risk Meeting dashboard",
      height: 680,
    }),
  },
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    return ensureRiskMeetingDashboard({
      email,
      orgId: getRequestOrgId() || null,
    });
  },
  link: ({ result }) => {
    const dashboardId =
      result && typeof result === "object"
        ? (result as { dashboardId?: string | null }).dashboardId
        : null;
    if (!dashboardId) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId },
      }),
      label: "Open Risk Meeting dashboard",
      view: "adhoc",
    };
  },
});
