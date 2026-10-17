import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import {
  BUILTIN_DASHBOARD_HIDDEN_BY,
  BUILTIN_DEMO_DASHBOARD_ID,
  BUILTIN_RISK_MEETING_DASHBOARD_ID,
  SEED_BUILTIN_DASHBOARD_IDS,
  builtinDashboardIdForLegacyId,
} from "../../shared/builtin-dashboard-ids";
import { normalizeDashboardConfig } from "../../shared/dashboard-config-normalization";
import { getDb, schema } from "../db/index.js";
import {
  buildBuiltinDashboard,
  installBuiltinDashboardOnce,
  loadBuiltinDashboard,
  recordBuiltinDashboardInstall,
  RISK_MEETING_COHORT_PROGRAM,
  RISK_MEETING_EARLY_WARNING_PROGRAM,
  withoutInstallTimes,
  type BuiltinDashboardInstall,
} from "./builtin-dashboards";
import {
  nativeV2DashboardManifests,
  type NativeV2Binding,
} from "./native-v2-dashboards";

/**
 * Moves the copies built-ins used to be installed as onto the built-ins.
 *
 * A copy is hidden only when nothing about it is anyone's work: its config is
 * exactly what ships today, and it has no shares, saved views, report
 * subscriptions, data notes, certification, folder, archive or hide of its
 * own. Every other copy stays an ordinary dashboard. Each copy is decided
 * once and recorded in `analytics_builtin_dashboard_checks`; `restore` undoes
 * the hides and keeps those copies from being hidden again.
 */

const BATCH_SIZE = 200;

export type KeepReason =
  | "edited"
  | "older_version"
  | "unrecognized"
  | "archived"
  | "hidden"
  | "certified"
  | "in_folder"
  | "shared"
  | "saved_views"
  | "report_subscriptions"
  | "data_notes";

export interface BuiltinDashboardPassResult {
  dryRun: boolean;
  checked: number;
  hidden: number;
  kept: number;
  alreadyChecked: number;
  keptByReason: Partial<Record<KeepReason, number>>;
  byBuiltin: Record<string, { hidden: number; kept: number }>;
}

type CandidateRow = typeof schema.dashboards.$inferSelect;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function shippedVersion(config: Record<string, unknown>): unknown {
  return (
    record(config.demo)?.version ?? record(config.catalog)?.templateVersion
  );
}

function panelProgram(
  config: Record<string, unknown>,
  panelId: string,
): NativeV2Binding | null {
  const panels = Array.isArray(config.panels) ? config.panels : [];
  const panel = panels.map(record).find((p) => p?.id === panelId);
  if (typeof panel?.sql !== "string") return null;
  try {
    const parsed = record(JSON.parse(panel.sql));
    return typeof parsed?.programId === "string"
      ? {
          programId: parsed.programId,
          ...(record(parsed.params)
            ? { params: parsed.params as Record<string, unknown> }
            : {}),
        }
      : null;
  } catch {
    // coercion-ok: a panel without a program binding leaves the copy unrecognized, so it is kept
    return null;
  }
}

/** The inputs a copy was installed with, read back from its panels. */
function installFromCopy(
  builtinId: string,
  row: CandidateRow,
  config: Record<string, unknown>,
): BuiltinDashboardInstall | null {
  const base = {
    installedAt:
      (record(config.catalog)?.installedAt as string | undefined) ??
      row.createdAt,
    installedBy: row.ownerEmail,
  };
  if (builtinId === BUILTIN_RISK_MEETING_DASHBOARD_ID) {
    const cohort = panelProgram(config, "risk-meeting-cohort-panel");
    const warning = panelProgram(config, "risk-meeting-early-warning-panel");
    return cohort && warning
      ? {
          ...base,
          programIds: {
            [RISK_MEETING_COHORT_PROGRAM]: cohort.programId,
            [RISK_MEETING_EARLY_WARNING_PROGRAM]: warning.programId,
          },
        }
      : null;
  }
  const manifest = nativeV2DashboardManifests.find(
    (m) => `builtin-${m.id}` === builtinId,
  );
  if (manifest) {
    const bindings: Record<string, NativeV2Binding> = {};
    for (const panel of manifest.panels) {
      if (!panel.bindingKey || bindings[panel.bindingKey]) continue;
      const binding = panelProgram(config, panel.id);
      if (!binding) return null;
      bindings[panel.bindingKey] = binding;
    }
    return { ...base, bindings };
  }
  return base;
}

function defaultVisibilities(builtinId: string): string[] {
  if (builtinId === BUILTIN_DEMO_DASHBOARD_ID) return ["private"];
  if (builtinId === BUILTIN_RISK_MEETING_DASHBOARD_ID) return ["private"];
  if (builtinId.startsWith("builtin-")) return ["org"];
  return ["private", "org"];
}

function candidateFilter() {
  const d = schema.dashboards;
  return and(
    eq(d.kind, "sql"),
    or(
      sql`${d.id} LIKE 'demo-node-exporter-%'`,
      sql`${d.id} LIKE 'native-%'`,
      eq(d.id, "risk-meeting"),
      inArray(d.id, [...SEED_BUILTIN_DASHBOARD_IDS]),
    ),
  );
}

async function referencedIds(ids: string[]): Promise<{
  shared: Set<string>;
  views: Set<string>;
  subscriptions: Set<string>;
  notes: Set<string>;
}> {
  const db = getDb() as any;
  const [shares, views, subscriptions] = await Promise.all([
    db
      .select({ id: schema.dashboardShares.resourceId })
      .from(schema.dashboardShares)
      .where(inArray(schema.dashboardShares.resourceId, ids)),
    db
      .select({ id: schema.dashboardViews.dashboardId })
      .from(schema.dashboardViews)
      .where(inArray(schema.dashboardViews.dashboardId, ids)),
    db
      .select({ id: schema.dashboardReportSubscriptions.dashboardId })
      .from(schema.dashboardReportSubscriptions)
      .where(inArray(schema.dashboardReportSubscriptions.dashboardId, ids)),
  ]);
  const notes = new Set<string>();
  for (const id of ids) {
    const needle = JSON.stringify({ dashboardId: id }).slice(1, -1);
    const [hit] = await db
      .select({ id: schema.analyticsDataNotes.id })
      .from(schema.analyticsDataNotes)
      .where(sql`strpos(${schema.analyticsDataNotes.panels}, ${needle}) > 0`)
      .limit(1);
    if (hit) notes.add(id);
  }
  const idSet = (rows: Array<{ id: string }>) => new Set(rows.map((r) => r.id));
  return {
    shared: idSet(shares),
    views: idSet(views),
    subscriptions: idSet(subscriptions),
    notes,
  };
}

export async function runBuiltinDashboardPass(
  options: { dryRun?: boolean } = {},
): Promise<BuiltinDashboardPassResult> {
  const dryRun = options.dryRun === true;
  const db = getDb() as any;
  const result: BuiltinDashboardPassResult = {
    dryRun,
    checked: 0,
    hidden: 0,
    kept: 0,
    alreadyChecked: 0,
    keptByReason: {},
    byBuiltin: {},
  };
  let cursor = "";
  for (;;) {
    // guard:allow-unscoped — deploy-time pass over every org; it reads ids and configs only to decide what to hide
    const batch: CandidateRow[] = await db
      .select()
      .from(schema.dashboards)
      .where(and(candidateFilter(), gt(schema.dashboards.id, cursor)))
      .orderBy(asc(schema.dashboards.id))
      .limit(BATCH_SIZE);
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    const rows = batch.filter(
      (row) =>
        builtinDashboardIdForLegacyId(row.id) &&
        row.hiddenBy !== BUILTIN_DASHBOARD_HIDDEN_BY,
    );
    if (rows.length === 0) continue;
    const ids = rows.map((row) => row.id);
    const checkedIds = new Set(
      (
        await db
          .select({ id: schema.analyticsBuiltinDashboardChecks.dashboardId })
          .from(schema.analyticsBuiltinDashboardChecks)
          .where(
            inArray(schema.analyticsBuiltinDashboardChecks.dashboardId, ids),
          )
      ).map((r: { id: string }) => r.id),
    );
    const refs = await referencedIds(ids);

    for (const row of rows) {
      if (checkedIds.has(row.id)) {
        result.alreadyChecked++;
        continue;
      }
      const builtinId = builtinDashboardIdForLegacyId(row.id)!;
      const reasons: KeepReason[] = [];
      let config: Record<string, unknown> | null = null;
      try {
        config = normalizeDashboardConfig(JSON.parse(row.config));
      } catch {
        reasons.push("unrecognized");
      }
      const install = config ? installFromCopy(builtinId, row, config) : null;
      const built = install ? buildBuiltinDashboard(builtinId, install) : null;
      if (config && !built) reasons.push("unrecognized");
      if (config && built) {
        const same =
          row.title === built.title &&
          stable(withoutInstallTimes(config)) ===
            stable(withoutInstallTimes(built.config));
        if (!same) {
          reasons.push(
            shippedVersion(config) !== shippedVersion(built.config)
              ? "older_version"
              : "edited",
          );
        }
      }
      if (row.archivedAt) reasons.push("archived");
      if (row.hiddenAt) reasons.push("hidden");
      if (row.certification) reasons.push("certified");
      if (row.folderId) reasons.push("in_folder");
      if (
        !defaultVisibilities(builtinId).includes(row.visibility) ||
        refs.shared.has(row.id)
      ) {
        reasons.push("shared");
      }
      if (refs.views.has(row.id)) reasons.push("saved_views");
      if (refs.subscriptions.has(row.id)) reasons.push("report_subscriptions");
      if (refs.notes.has(row.id)) reasons.push("data_notes");

      const outcome = reasons.length === 0 ? "hidden" : "kept";
      result.checked++;
      result[outcome]++;
      const tally = (result.byBuiltin[builtinId] ??= { hidden: 0, kept: 0 });
      tally[outcome]++;
      for (const reason of reasons) {
        result.keptByReason[reason] = (result.keptByReason[reason] ?? 0) + 1;
      }
      if (dryRun) continue;

      // The org keeps the built-in either way; a kept copy just stands beside it.
      if (install && builtinId !== BUILTIN_DEMO_DASHBOARD_ID) {
        const scope = { email: row.ownerEmail, orgId: row.orgId ?? null };
        if (install.bindings || install.programIds) {
          if (!(await loadBuiltinDashboard(builtinId, scope))) {
            await recordBuiltinDashboardInstall(scope, builtinId, install);
          }
        } else if (builtinId === "google-analytics") {
          await installBuiltinDashboardOnce(scope, builtinId);
        }
      }

      await db.transaction(async (tx: any) => {
        if (outcome === "hidden") {
          const hidden = await tx
            .update(schema.dashboards)
            .set({
              hiddenAt: new Date().toISOString(),
              hiddenBy: BUILTIN_DASHBOARD_HIDDEN_BY,
            })
            .where(
              and(
                eq(schema.dashboards.id, row.id),
                eq(schema.dashboards.updatedAt, row.updatedAt),
                isNull(schema.dashboards.hiddenAt),
              ),
            )
            .returning({ id: schema.dashboards.id });
          // Somebody saved it mid-pass; the next deploy decides it afresh.
          if (hidden.length === 0) return;
        }
        await tx
          .insert(schema.analyticsBuiltinDashboardChecks)
          .values({
            dashboardId: row.id,
            builtinId,
            outcome,
            reasons: JSON.stringify(reasons),
            ownerEmail: row.ownerEmail,
            orgId: row.orgId ?? null,
            rowUpdatedAt: row.updatedAt,
          })
          .onConflictDoNothing();
      });
    }
  }
  return result;
}

/** Unhides every copy the pass hid; they are never hidden again. */
export async function restoreBuiltinDashboardPass(): Promise<{
  restored: number;
}> {
  const db = getDb() as any;
  const checks = schema.analyticsBuiltinDashboardChecks;
  let restored = 0;
  for (;;) {
    const batch: Array<{ id: string }> = await db
      .select({ id: checks.dashboardId })
      .from(checks)
      .where(and(eq(checks.outcome, "hidden"), isNull(checks.restoredAt)))
      .orderBy(asc(checks.dashboardId))
      .limit(BATCH_SIZE);
    if (batch.length === 0) break;
    const ids = batch.map((row) => row.id);
    await db.transaction(async (tx: any) => {
      await tx
        .update(schema.dashboards)
        .set({ hiddenAt: null, hiddenBy: null })
        .where(
          and(
            inArray(schema.dashboards.id, ids),
            eq(schema.dashboards.hiddenBy, BUILTIN_DASHBOARD_HIDDEN_BY),
          ),
        );
      await tx
        .update(checks)
        .set({ restoredAt: new Date().toISOString() })
        .where(inArray(checks.dashboardId, ids));
    });
    restored += ids.length;
  }
  return { restored };
}
