import { randomUUID } from "node:crypto";

import { recordChange } from "@agent-native/core/server";
import {
  createSharesTable,
  ownableColumns,
  table,
  text,
} from "@agent-native/core/db/schema";
import { listOrgSettings } from "@agent-native/core/settings";
import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

const migrationExtensions = table("tools", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  content: text("content").notNull(),
  icon: text("icon"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  archivedAt: text("archived_at"),
  hiddenAt: text("hidden_at"),
  hiddenBy: text("hidden_by"),
  ...ownableColumns(),
});

const migrationExtensionData = table("tool_data", {
  id: text("id").primaryKey(),
  extensionId: text("tool_id").notNull(),
  orgId: text("org_id"),
});

const migrationExtensionShares = createSharesTable("tool_shares");
const migrationSettings = table("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

type Visibility = "private" | "org" | "public";
type SourceType = "analysis" | "extension";

export interface AnalyticsArtifactMigrationContext {
  userEmail: string;
  orgId: string;
}

export interface AnalyticsArtifactMigrationSummary {
  dryRun: boolean;
  orgId: string;
  legacyDashboards: number;
  legacyAnalyses: number;
  dashboardsMaterialized: number;
  analysesMaterialized: number;
  dashboardsCreated: number;
  analysisDashboardsCreated: number;
  extensionDashboardsCreated: number;
  duplicateDashboardsArchived: number;
  duplicateAnalysesHidden: number;
  duplicateExtensionsArchived: number;
  analysesHidden: number;
  extensionsHidden: number;
  legacySettingsDeleted: number;
  dashboardReferencesRewritten: number;
  skipped: Array<{ type: string; id: string; reason: string }>;
}

interface LegacyDashboard {
  id: string;
  kind: "explorer" | "sql";
  data: Record<string, unknown>;
}

interface LegacyAnalysis {
  id: string;
  data: Record<string, unknown>;
}

interface DashboardSource {
  id: string;
  kind: "explorer" | "sql";
  title: string;
  config: Record<string, unknown>;
  ownerEmail: string;
  orgId: string;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  hiddenAt: string | null;
}

interface AnalysisSource {
  id: string;
  name: string;
  description: string;
  question: string;
  instructions: string;
  dataSources: string[];
  resultMarkdown: string;
  resultData: Record<string, unknown> | null;
  author: string | null;
  ownerEmail: string;
  orgId: string;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  hiddenAt: string | null;
}

interface ExtensionSource {
  id: string;
  name: string;
  description: string;
  content: string;
  icon: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  hiddenAt: string | null;
  ownerEmail: string;
  orgId: string;
  visibility: Visibility;
}

interface MigrationState {
  dashboards: DashboardSource[];
  analyses: AnalysisSource[];
  extensions: ExtensionSource[];
  legacyDashboardKeys: string[];
  legacyAnalysisKeys: string[];
  extensionDataIds: Set<string>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function scopedFingerprint(
  visibility: Visibility,
  ownerEmail: string,
  value: unknown,
): string {
  return stableStringify({
    scope: visibility === "org" ? "org" : ownerEmail.toLowerCase(),
    visibility,
    value,
  });
}

function dashboardTitle(data: Record<string, unknown>): string {
  const title = data.title ?? data.name;
  return typeof title === "string" && title.trim() ? title.trim() : "Untitled";
}

function timestamp(data: Record<string, unknown>, fallback: string): string {
  return typeof data.updatedAt === "string" && data.updatedAt
    ? data.updatedAt
    : typeof data.createdAt === "string" && data.createdAt
      ? data.createdAt
      : fallback;
}

function legacyDashboardRows(
  settings: Record<string, Record<string, unknown>>,
  ctx: AnalyticsArtifactMigrationContext,
): { rows: LegacyDashboard[]; keys: string[] } {
  const rows: LegacyDashboard[] = [];
  const keys: string[] = [];
  for (const [key, data] of Object.entries(settings)) {
    if (key.startsWith("sql-dashboard-")) {
      rows.push({
        id: key.slice("sql-dashboard-".length),
        kind: "sql",
        data,
      });
      keys.push(key);
    } else if (key.startsWith("dashboard-")) {
      rows.push({
        id: key.slice("dashboard-".length),
        kind: "explorer",
        data,
      });
      keys.push(key);
    }
  }
  void ctx;
  return { rows, keys };
}

function legacyAnalysisRows(
  settings: Record<string, Record<string, unknown>>,
): { rows: LegacyAnalysis[]; keys: string[] } {
  const rows: LegacyAnalysis[] = [];
  const keys: string[] = [];
  for (const [key, data] of Object.entries(settings)) {
    if (!key.startsWith("adhoc-analysis-")) continue;
    rows.push({ id: key.slice("adhoc-analysis-".length), data });
    keys.push(key);
  }
  return { rows, keys };
}

async function readMigrationState(
  ctx: AnalyticsArtifactMigrationContext,
): Promise<MigrationState> {
  const db = getDb() as any;
  const orgSettings = await listOrgSettings(ctx.orgId);
  const legacyDashboards = legacyDashboardRows(orgSettings, ctx);
  const legacyAnalyses = legacyAnalysisRows(orgSettings);

  const [dashboardRows, analysisRows, extensionRows, extensionDataRows] =
    await Promise.all([
      db
        .select()
        .from(schema.dashboards)
        .where(eq(schema.dashboards.orgId, ctx.orgId)),
      db
        .select()
        .from(schema.analyses)
        .where(eq(schema.analyses.orgId, ctx.orgId)),
      db
        .select()
        .from(migrationExtensions)
        .where(eq(migrationExtensions.orgId, ctx.orgId)),
      db
        .select({ extensionId: migrationExtensionData.extensionId })
        .from(migrationExtensionData)
        .where(eq(migrationExtensionData.orgId, ctx.orgId)),
    ]);

  const now = nowIso();
  const materializedDashboardIds = new Set(
    dashboardRows.map((row: { id: string }) => row.id),
  );
  const materializedAnalysisIds = new Set(
    analysisRows.map((row: { id: string }) => row.id),
  );

  const dashboards: DashboardSource[] = dashboardRows.map((row: any) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    config: parseJson(row.config),
    ownerEmail: row.ownerEmail,
    orgId: row.orgId,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? null,
    hiddenAt: row.hiddenAt ?? null,
  }));

  for (const row of legacyDashboards.rows) {
    if (materializedDashboardIds.has(row.id)) continue;
    dashboards.push({
      id: row.id,
      kind: row.kind,
      title: dashboardTitle(row.data),
      config: row.data,
      ownerEmail: ctx.userEmail,
      orgId: ctx.orgId,
      visibility: "org",
      createdAt:
        typeof row.data.createdAt === "string" ? row.data.createdAt : now,
      updatedAt: timestamp(row.data, now),
      archivedAt: null,
      hiddenAt: null,
    });
  }

  const analyses: AnalysisSource[] = analysisRows.map((row: any) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    question: row.question,
    instructions: row.instructions,
    dataSources: parseArray<string>(row.dataSources),
    resultMarkdown: row.resultMarkdown,
    resultData: row.resultData ? parseJson(row.resultData) : null,
    author: row.author ?? null,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hiddenAt: row.hiddenAt ?? null,
  }));

  for (const row of legacyAnalyses.rows) {
    if (materializedAnalysisIds.has(row.id)) continue;
    analyses.push({
      id: row.id,
      name: typeof row.data.name === "string" ? row.data.name : "Untitled",
      description:
        typeof row.data.description === "string" ? row.data.description : "",
      question:
        typeof row.data.question === "string" ? row.data.question : "",
      instructions:
        typeof row.data.instructions === "string" ? row.data.instructions : "",
      dataSources: parseArray<string>(row.data.dataSources),
      resultMarkdown:
        typeof row.data.resultMarkdown === "string" ? row.data.resultMarkdown : "",
      resultData: row.data.resultData ? parseJson(row.data.resultData) : null,
      author: typeof row.data.author === "string" ? row.data.author : ctx.userEmail,
      ownerEmail: ctx.userEmail,
      orgId: ctx.orgId,
      visibility: "org",
      createdAt:
        typeof row.data.createdAt === "string" ? row.data.createdAt : now,
      updatedAt: timestamp(row.data, now),
      hiddenAt: null,
    });
  }

  return {
    dashboards,
    analyses,
    extensions: extensionRows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      content: row.content,
      icon: row.icon ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt ?? null,
      hiddenAt: row.hiddenAt ?? null,
      ownerEmail: row.ownerEmail,
      orgId: row.orgId,
      visibility: row.visibility,
    })),
    legacyDashboardKeys: legacyDashboards.keys,
    legacyAnalysisKeys: legacyAnalyses.keys,
    extensionDataIds: new Set(
      extensionDataRows.map((row: { extensionId: string }) => row.extensionId),
    ),
  };
}

function duplicateDashboardGroups(rows: DashboardSource[]): DashboardSource[][] {
  const groups = new Map<string, DashboardSource[]>();
  for (const row of rows) {
    if (row.archivedAt) continue;
    const key = scopedFingerprint(row.visibility, row.ownerEmail, {
      kind: row.kind,
      title: row.title,
      config: row.config,
    });
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Array.from(groups.values()).filter((group) => group.length > 1);
}

function duplicateAnalysisGroups(rows: AnalysisSource[]): AnalysisSource[][] {
  const groups = new Map<string, AnalysisSource[]>();
  for (const row of rows) {
    const key = scopedFingerprint(row.visibility, row.ownerEmail, {
      name: row.name,
      description: row.description,
      question: row.question,
      instructions: row.instructions,
      dataSources: row.dataSources,
      resultMarkdown: row.resultMarkdown,
      resultData: row.resultData,
    });
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Array.from(groups.values()).filter((group) => group.length > 1);
}

function duplicateExtensionGroups(rows: ExtensionSource[]): ExtensionSource[][] {
  const groups = new Map<string, ExtensionSource[]>();
  for (const row of rows) {
    if (row.archivedAt) continue;
    const key = scopedFingerprint(row.visibility, row.ownerEmail, {
      name: row.name,
      description: row.description,
      content: row.content,
      icon: row.icon,
    });
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Array.from(groups.values()).filter((group) => group.length > 1);
}

function oldest<T extends { createdAt: string; id: string }>(rows: T[]): T {
  return [...rows].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )[0];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function analysisExtensionContent(analysis: AnalysisSource): string {
  const sourceList = analysis.dataSources.length
    ? `<p><strong>Data sources:</strong> ${escapeHtml(analysis.dataSources.join(", "))}</p>`
    : "";
  const question = analysis.question
    ? `<p><strong>Question:</strong> ${escapeHtml(analysis.question)}</p>`
    : "";
  const description = analysis.description
    ? `<p>${escapeHtml(analysis.description)}</p>`
    : "";
  const result = analysis.resultMarkdown || "No saved result.";
  return `<article style="font-family:system-ui,sans-serif;color:inherit;line-height:1.5;padding:20px;max-width:900px;margin:auto"><h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(analysis.name)}</h1>${description}${question}${sourceList}<pre style="white-space:pre-wrap;font:inherit;margin:20px 0 0">${escapeHtml(result)}</pre></article>`;
}

function migratedDashboardConfig(
  name: string,
  description: string,
  extensionId: string,
  sourceType: SourceType,
  sourceId: string,
): Record<string, unknown> {
  return {
    name,
    description,
    migration: { sourceType, sourceId },
    panels: [
      {
        id: `${sourceType}-content`,
        title: name,
        sql: "",
        source: "first-party",
        chartType: "extension",
        width: 1,
        config: { extensionId },
      },
    ],
  };
}

function sourceMigrationKey(config: Record<string, unknown>): string | null {
  const migration = config.migration;
  if (!migration || typeof migration !== "object") return null;
  const source = migration as Record<string, unknown>;
  if (
    (source.sourceType === "analysis" || source.sourceType === "extension") &&
    typeof source.sourceId === "string"
  ) {
    return `${source.sourceType}:${source.sourceId}`;
  }
  return null;
}

function remapExtensionIds(
  value: unknown,
  replacements: Map<string, string>,
): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = remapExtensionIds(item, replacements);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }
  if (!value || typeof value !== "object") return { value, changed: false };
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === "extensionId" && typeof nested === "string") {
      const replacement = replacements.get(nested);
      if (replacement) {
        next[key] = replacement;
        changed = true;
        continue;
      }
    }
    const result = remapExtensionIds(nested, replacements);
    next[key] = result.value;
    changed ||= result.changed;
  }
  return { value: next, changed };
}

async function copyShares(
  tx: any,
  sourceTable: any,
  targetTable: any,
  sourceId: string,
  targetId: string,
  runId: string,
): Promise<void> {
  const [sourceRows, targetRows] = await Promise.all([
    tx.select().from(sourceTable).where(eq(sourceTable.resourceId, sourceId)),
    tx.select().from(targetTable).where(eq(targetTable.resourceId, targetId)),
  ]);
  const existing = new Set(
    targetRows.map(
      (row: any) => `${row.principalType}:${row.principalId}:${row.role}`,
    ),
  );
  const values = sourceRows
    .filter((row: any) => {
      const key = `${row.principalType}:${row.principalId}:${row.role}`;
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    })
    .map((row: any) => ({
      id: `${runId}-${randomUUID()}`,
      resourceId: targetId,
      principalType: row.principalType,
      principalId: row.principalId,
      role: row.role,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    }));
  if (values.length > 0) await tx.insert(targetTable).values(values);
}

function summaryTemplate(
  ctx: AnalyticsArtifactMigrationContext,
  dryRun: boolean,
): AnalyticsArtifactMigrationSummary {
  return {
    dryRun,
    orgId: ctx.orgId,
    legacyDashboards: 0,
    legacyAnalyses: 0,
    dashboardsMaterialized: 0,
    analysesMaterialized: 0,
    dashboardsCreated: 0,
    analysisDashboardsCreated: 0,
    extensionDashboardsCreated: 0,
    duplicateDashboardsArchived: 0,
    duplicateAnalysesHidden: 0,
    duplicateExtensionsArchived: 0,
    analysesHidden: 0,
    extensionsHidden: 0,
    legacySettingsDeleted: 0,
    dashboardReferencesRewritten: 0,
    skipped: [],
  };
}

export async function migrateAnalyticsArtifacts(
  ctx: AnalyticsArtifactMigrationContext,
  options: { dryRun: boolean },
): Promise<AnalyticsArtifactMigrationSummary> {
  const state = await readMigrationState(ctx);
  const summary = summaryTemplate(ctx, options.dryRun);
  summary.legacyDashboards = state.legacyDashboardKeys.length;
  summary.legacyAnalyses = state.legacyAnalysisKeys.length;
  summary.dashboardsMaterialized = state.dashboards.filter((row) =>
    state.legacyDashboardKeys.some((key) => key.endsWith(row.id)),
  ).length;
  summary.analysesMaterialized = state.analyses.filter((row) =>
    state.legacyAnalysisKeys.some((key) => key.endsWith(row.id)),
  ).length;

  const dashboardDuplicates = duplicateDashboardGroups(state.dashboards);
  const analysisDuplicates = duplicateAnalysisGroups(state.analyses);
  const extensionDuplicates = duplicateExtensionGroups(state.extensions);
  const duplicateDashboardMap = new Map<string, string>();
  const duplicateAnalysisMap = new Map<string, string>();
  const duplicateExtensionMap = new Map<string, string>();

  for (const group of dashboardDuplicates) {
    const canonical = oldest(group);
    for (const row of group) {
      if (row.id !== canonical.id) duplicateDashboardMap.set(row.id, canonical.id);
    }
  }
  for (const group of analysisDuplicates) {
    const canonical = oldest(group);
    for (const row of group) {
      if (row.id !== canonical.id) duplicateAnalysisMap.set(row.id, canonical.id);
    }
  }
  for (const group of extensionDuplicates) {
    const canonical = oldest(group);
    for (const row of group) {
      if (row.id !== canonical.id && !state.extensionDataIds.has(row.id)) {
        duplicateExtensionMap.set(row.id, canonical.id);
      }
    }
  }

  if (options.dryRun) {
    summary.duplicateDashboardsArchived = duplicateDashboardMap.size;
    summary.duplicateAnalysesHidden = duplicateAnalysisMap.size;
    summary.duplicateExtensionsArchived = duplicateExtensionMap.size;
    summary.analysisDashboardsCreated = state.analyses.filter(
      (row) => !duplicateAnalysisMap.has(row.id),
    ).length;
    summary.extensionDashboardsCreated = state.extensions.filter(
      (row) =>
        !row.archivedAt &&
        !duplicateExtensionMap.has(row.id) &&
        !state.dashboards.some(
          (dashboard) =>
            sourceMigrationKey(dashboard.config) === `extension:${row.id}`,
        ),
    ).length;
    summary.dashboardsCreated =
      summary.analysisDashboardsCreated + summary.extensionDashboardsCreated;
    return summary;
  }

  const db = getDb() as any;
  const runId = `artifact-migration-${Date.now()}`;
  const now = nowIso();
  await db.transaction(async (tx: any) => {
    for (const row of state.dashboards) {
      await tx
        .insert(schema.dashboards)
        .values({
          id: row.id,
          kind: row.kind,
          title: row.title,
          config: JSON.stringify(row.config),
          ownerEmail: row.ownerEmail,
          orgId: row.orgId,
          visibility: row.visibility,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          updatedBy: ctx.userEmail,
          archivedAt: row.archivedAt,
          hiddenAt: row.hiddenAt,
          hiddenBy: null,
      })
        .onConflictDoNothing();
    }
    for (const row of state.analyses) {
      await tx
        .insert(schema.analyses)
        .values({
          id: row.id,
          name: row.name,
          description: row.description,
          question: row.question,
          instructions: row.instructions,
          dataSources: JSON.stringify(row.dataSources),
          resultMarkdown: row.resultMarkdown,
          resultData: row.resultData ? JSON.stringify(row.resultData) : null,
          author: row.author,
          ownerEmail: row.ownerEmail,
          orgId: row.orgId,
          visibility: row.visibility,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          hiddenAt: row.hiddenAt,
          hiddenBy: null,
      })
        .onConflictDoNothing();
    }

    for (const [duplicateId, canonicalId] of duplicateDashboardMap) {
      await copyShares(
        tx,
        schema.dashboardShares,
        schema.dashboardShares,
        duplicateId,
        canonicalId,
        runId,
      );
      await tx
        .update(schema.dashboardViews)
        .set({ dashboardId: canonicalId })
        .where(eq(schema.dashboardViews.dashboardId, duplicateId));
      await tx
        .update(schema.dashboardReportSubscriptions)
        .set({ dashboardId: canonicalId, updatedAt: now })
        .where(
          eq(schema.dashboardReportSubscriptions.dashboardId, duplicateId),
        );
      await tx
        .update(schema.dashboards)
        .set({ archivedAt: now, updatedAt: now, updatedBy: ctx.userEmail })
        .where(eq(schema.dashboards.id, duplicateId));
      summary.duplicateDashboardsArchived += 1;
    }

    for (const [duplicateId, canonicalId] of duplicateAnalysisMap) {
      await copyShares(
        tx,
        schema.analysisShares,
        schema.analysisShares,
        duplicateId,
        canonicalId,
        runId,
      );
      await tx
        .update(schema.analyses)
        .set({ hiddenAt: now, hiddenBy: ctx.userEmail, updatedAt: now })
        .where(eq(schema.analyses.id, duplicateId));
      summary.duplicateAnalysesHidden += 1;
    }

    for (const [duplicateId, canonicalId] of duplicateExtensionMap) {
      await copyShares(
        tx,
        migrationExtensionShares,
        migrationExtensionShares,
        duplicateId,
        canonicalId,
        runId,
      );
      for (const dashboard of state.dashboards) {
        const remapped = remapExtensionIds(dashboard.config, new Map([[duplicateId, canonicalId]]));
        if (!remapped.changed) continue;
        await tx
          .update(schema.dashboards)
          .set({
            config: JSON.stringify(remapped.value),
            updatedAt: now,
            updatedBy: ctx.userEmail,
          })
          .where(eq(schema.dashboards.id, dashboard.id));
        summary.dashboardReferencesRewritten += 1;
      }
      await tx
        .update(migrationExtensions)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(migrationExtensions.id, duplicateId));
      summary.duplicateExtensionsArchived += 1;
    }

    const extensionReplacements = duplicateExtensionMap;
    const currentDashboards = state.dashboards.filter(
      (row) => !duplicateDashboardMap.has(row.id) && !row.archivedAt,
    );
    const referencedExtensionIds = new Set<string>();
    for (const dashboard of currentDashboards) {
      const remapped = remapExtensionIds(dashboard.config, extensionReplacements);
      const config = parseJson(remapped.value);
      const json = JSON.stringify(config);
      const matches = json.matchAll(/"extensionId"\s*:\s*"([^"]+)"/g);
      for (const match of matches) referencedExtensionIds.add(match[1]);
    }

    for (const analysis of state.analyses) {
      if (duplicateAnalysisMap.has(analysis.id)) continue;
      const dashboardId = `dashboard-from-analysis-${analysis.id}`;
      const extensionId = `extension-from-analysis-${analysis.id}`;
      const dashboardExists = await tx
        .select({ id: schema.dashboards.id })
        .from(schema.dashboards)
        .where(eq(schema.dashboards.id, dashboardId));
      if (dashboardExists.length === 0) {
        await tx.insert(migrationExtensions).values({
          id: extensionId,
          name: `Dashboard content: ${analysis.name}`,
          description: "Hidden implementation block for a migrated dashboard.",
          content: analysisExtensionContent(analysis),
          icon: null,
          createdAt: analysis.createdAt,
          updatedAt: analysis.updatedAt,
          archivedAt: null,
          hiddenAt: now,
          hiddenBy: ctx.userEmail,
          ownerEmail: analysis.ownerEmail,
          orgId: analysis.orgId,
          visibility: analysis.visibility === "public" ? "org" : analysis.visibility,
        }).onConflictDoNothing();
        await copyShares(
          tx,
          schema.analysisShares,
          migrationExtensionShares,
          analysis.id,
          extensionId,
          runId,
        );
        await tx.insert(schema.dashboards).values({
          id: dashboardId,
          kind: "sql",
          title: analysis.name,
          config: JSON.stringify(
            migratedDashboardConfig(
              analysis.name,
              analysis.description,
              extensionId,
              "analysis",
              analysis.id,
            ),
          ),
          ownerEmail: analysis.ownerEmail,
          orgId: analysis.orgId,
          visibility: analysis.visibility,
          createdAt: analysis.createdAt,
          updatedAt: now,
          updatedBy: ctx.userEmail,
          hiddenAt: analysis.hiddenAt,
          hiddenBy: analysis.hiddenAt ? ctx.userEmail : null,
        });
        await copyShares(
          tx,
          schema.analysisShares,
          schema.dashboardShares,
          analysis.id,
          dashboardId,
          runId,
        );
        summary.analysisDashboardsCreated += 1;
        summary.dashboardsCreated += 1;
      }
      await tx
        .update(schema.analyses)
        .set({ hiddenAt: analysis.hiddenAt ?? now, hiddenBy: ctx.userEmail, updatedAt: now })
        .where(eq(schema.analyses.id, analysis.id));
      if (!analysis.hiddenAt) summary.analysesHidden += 1;
    }

    for (const extension of state.extensions) {
      if (extension.archivedAt || duplicateExtensionMap.has(extension.id)) continue;
      if (referencedExtensionIds.has(extension.id)) {
        await tx
          .update(migrationExtensions)
          .set({ hiddenAt: extension.hiddenAt ?? now, hiddenBy: ctx.userEmail, updatedAt: now })
          .where(eq(migrationExtensions.id, extension.id));
        if (!extension.hiddenAt) summary.extensionsHidden += 1;
        continue;
      }
      const dashboardId = `dashboard-from-extension-${extension.id}`;
      const existing = await tx
        .select({ id: schema.dashboards.id })
        .from(schema.dashboards)
        .where(eq(schema.dashboards.id, dashboardId));
      if (existing.length === 0) {
        await tx.insert(schema.dashboards).values({
          id: dashboardId,
          kind: "sql",
          title: extension.name,
          config: JSON.stringify(
            migratedDashboardConfig(
              extension.name,
              extension.description,
              extension.id,
              "extension",
              extension.id,
            ),
          ),
          ownerEmail: extension.ownerEmail,
          orgId: extension.orgId,
          visibility: extension.visibility,
          createdAt: extension.createdAt,
          updatedAt: now,
          updatedBy: ctx.userEmail,
          hiddenAt: extension.hiddenAt,
          hiddenBy: extension.hiddenAt ? ctx.userEmail : null,
        });
        await copyShares(
          tx,
          migrationExtensionShares,
          schema.dashboardShares,
          extension.id,
          dashboardId,
          runId,
        );
        summary.extensionDashboardsCreated += 1;
        summary.dashboardsCreated += 1;
      }
      await tx
        .update(migrationExtensions)
        .set({ hiddenAt: extension.hiddenAt ?? now, hiddenBy: ctx.userEmail, updatedAt: now })
        .where(eq(migrationExtensions.id, extension.id));
      if (!extension.hiddenAt) summary.extensionsHidden += 1;
    }

    const legacyKeys = [
      ...state.legacyDashboardKeys,
      ...state.legacyAnalysisKeys,
    ].map((key) => `o:${ctx.orgId}:${key}`);
    for (let offset = 0; offset < legacyKeys.length; offset += 500) {
      const chunk = legacyKeys.slice(offset, offset + 500);
      if (chunk.length === 0) continue;
      await tx.delete(migrationSettings).where(inArray(migrationSettings.key, chunk));
      summary.legacySettingsDeleted += chunk.length;
    }
  });

  recordChange({ source: "dashboards", type: "change", key: ctx.orgId, orgId: ctx.orgId });
  recordChange({ source: "analyses", type: "change", key: ctx.orgId, orgId: ctx.orgId });
  recordChange({ source: "extensions", type: "change", key: ctx.orgId, orgId: ctx.orgId });
  return summary;
}

export async function analyticsArtifactMigrationInventory(
  ctx: AnalyticsArtifactMigrationContext,
): Promise<AnalyticsArtifactMigrationSummary> {
  return migrateAnalyticsArtifacts(ctx, { dryRun: true });
}
