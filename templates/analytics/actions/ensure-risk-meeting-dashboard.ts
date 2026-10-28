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

import {
  loadBuiltinDashboard,
  recordBuiltinDashboardInstall,
  RISK_MEETING_COHORT_PROGRAM as COHORT_PROGRAM_NAME,
  RISK_MEETING_EARLY_WARNING_PROGRAM as EARLY_WARNING_PROGRAM_NAME,
} from "../server/lib/builtin-dashboards";
import { BUILTIN_RISK_MEETING_DASHBOARD_ID } from "../shared/builtin-dashboard-ids";

const APP_ID = "analytics";
const REFRESH_MODE = "ttl" as const;
const REFRESH_TTL_MS = 900_000;

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

const seedCodeCache = new Map<string, string>();

function loadProgramCode(filename: string): string {
  const cached = seedCodeCache.get(filename);
  if (cached !== undefined) return cached;

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = Array.from(
    new Set([
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

interface EnsureCtx {
  email: string;
  orgId: string | null;
}

export interface EnsureRiskMeetingDashboardResult {
  dashboardId: string;
  programIds: Record<string, string>;
  created: boolean;
}

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

  const scope = { email: ctx.email, orgId: ctx.orgId ?? null };
  const existing = await loadBuiltinDashboard(
    BUILTIN_RISK_MEETING_DASHBOARD_ID,
    scope,
  );
  await recordBuiltinDashboardInstall(
    scope,
    BUILTIN_RISK_MEETING_DASHBOARD_ID,
    {
      programIds,
    },
  );

  return {
    dashboardId: BUILTIN_RISK_MEETING_DASHBOARD_ID,
    programIds,
    created: !existing,
  };
}

export default defineAction({
  description:
    "Install (or update, idempotently) the built-in, read-only Risk Meeting dashboard: a worked example of the " +
    "generic provider-access pattern combining a HubSpot deal-property risk cohort (arbitrary " +
    "property IN-search), a HubSpot deal -> company -> domain join, and a Pylon account " +
    "sentiment join, entirely inside two stored data programs with zero vendor-specific action " +
    "code. Safe to re-run: upserts the same data programs by name and records the install for the organization; " +
    "the dashboard itself ships with the app, and duplicate-dashboard makes an editable copy. " +
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
