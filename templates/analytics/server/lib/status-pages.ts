/**
 * Public status pages.
 *
 * A status page bundles a set of the owner's uptime monitors under a public
 * `slug` and renders their SAFE aggregate health to anyone with the link — but
 * only once the owner publishes it.
 *
 * Security model (see the `security` and `sharing` skills):
 *  - CRUD (`listStatusPages` / `getStatusPage` / `saveStatusPage` /
 *    `deleteStatusPage` + monitor management) is owner-scoped by
 *    owner_email + org_id, mirroring server/lib/uptime-monitors.ts. Monitors
 *    added to a page are verified to belong to the caller.
 *  - `getPublicStatusPage(slug)` is the ONLY unauthenticated read. It returns
 *    a page strictly when `published` is true, resolves the included monitors
 *    scoped to THE PAGE OWNER (never the anonymous requester), and returns
 *    only a sanitized projection — display name / host, current status, uptime
 *    percentages, timeline buckets, and optional response time. It NEVER leaks
 *    the monitor URL/headers/body/assertions/expected-status/alert channels,
 *    and only surfaces the full URL for a monitor whose per-page "show URL"
 *    opt-in is set.
 *  - The pure helpers (`normalizeSlug`, `parseStatusPageMonitors`,
 *    `sanitizePublicMonitor`, `computeOverallStatus`, `aggregateWindows`) are
 *    unit-tested (status-pages.spec.ts).
 */
import { randomUUID } from "node:crypto";

import { recordChange } from "@agent-native/core/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  getMonitorStats,
  type MonitorStats,
  type ResponseTimePoint,
  type UptimeBucket,
  type UptimeWindows,
} from "./monitor-stats.js";
import { type AccessCtx, type MonitorStatus } from "./uptime-monitors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StatusPageDensity = "comfortable" | "compact";
export type StatusPageAlignment = "left" | "center";

export interface StatusPageMonitorRef {
  monitorId: string;
  order: number;
  displayName: string | null;
  showUrl: boolean;
}

export interface StatusPage {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  published: boolean;
  showUptimeBars: boolean;
  showOverallUptime: boolean;
  showResponseTime: boolean;
  density: StatusPageDensity;
  alignment: StatusPageAlignment;
  monitors: StatusPageMonitorRef[];
  createdAt: string;
  updatedAt: string;
  ownerEmail: string;
  orgId: string | null;
}

export interface StatusPageMonitorInput {
  monitorId: string;
  displayName?: string | null;
  showUrl?: boolean;
}

export interface StatusPageInput {
  id?: string;
  slug?: string;
  title?: string;
  description?: string | null;
  published?: boolean;
  showUptimeBars?: boolean;
  showOverallUptime?: boolean;
  showResponseTime?: boolean;
  density?: StatusPageDensity;
  alignment?: StatusPageAlignment;
  monitors?: StatusPageMonitorInput[];
}

export type OverallStatus = "operational" | "degraded" | "down" | "unknown";

/** Sanitized, public-safe monitor projection. NO sensitive config fields. */
export interface PublicStatusMonitor {
  id: string;
  name: string;
  /** Host of the monitored URL — safe to show; the full URL is gated by showUrl. */
  host: string | null;
  /** Full URL, only present when the owner enabled "show URL" for this monitor. */
  url: string | null;
  status: MonitorStatus | null;
  windows: UptimeWindows;
  timeline: UptimeBucket[];
  responseSeries: ResponseTimePoint[];
  avgResponseMs: number | null;
}

export interface PublicStatusPage {
  slug: string;
  title: string;
  description: string | null;
  layout: {
    density: StatusPageDensity;
    alignment: StatusPageAlignment;
    showUptimeBars: boolean;
    showOverallUptime: boolean;
    showResponseTime: boolean;
  };
  overall: OverallStatus;
  counts: { up: number; down: number; degraded: number; total: number };
  overallWindows: UptimeWindows;
  monitors: PublicStatusMonitor[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_STATUS_PAGES_PER_OWNER = 50;
const MAX_MONITORS_PER_PAGE = 50;
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_SLUG_LENGTH = 64;
const TIMELINE_DAYS = 90;
const RESPONSE_WINDOW_HOURS_WITH_CHART = 24 * 7;

const EMPTY_WINDOWS: UptimeWindows = {
  uptime24h: null,
  uptime7d: null,
  uptime30d: null,
  uptime90d: null,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Strict host extraction for the public boundary: returns ONLY the host of a
 * parseable http(s) URL, never the raw string. If the value can't be parsed we
 * return null rather than risk leaking a full URL/path/query to the public.
 */
function safeHost(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return parsed.host || null;
  } catch {
    return null;
  }
}

/** Coarse tone for a monitor status (server-local; avoids importing client utils). */
function statusToTone(
  status: MonitorStatus | null,
): "up" | "down" | "degraded" | "neutral" {
  switch (status) {
    case "up":
      return "up";
    case "down":
    case "error":
      return "down";
    case "degraded":
      return "degraded";
    default:
      return "neutral";
  }
}

// ---------------------------------------------------------------------------
// Pure normalization + sanitization (unit-tested)
// ---------------------------------------------------------------------------

/** URL-safe slug: lowercase, `[a-z0-9-]`, collapsed/trimmed dashes. */
export function normalizeSlug(raw: unknown): string {
  return String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, "");
}

function normalizeDensity(value: unknown): StatusPageDensity {
  return value === "compact" ? "compact" : "comfortable";
}

function normalizeAlignment(value: unknown): StatusPageAlignment {
  return value === "center" ? "center" : "left";
}

function normalizeDisplayName(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_DISPLAY_NAME_LENGTH);
}

/**
 * Parse the stored `monitors` JSON into ordered, de-duplicated refs. Invalid
 * entries are dropped; `order` is assigned by position so callers never depend
 * on the stored order field being trustworthy.
 */
export function parseStatusPageMonitors(raw: unknown): StatusPageMonitorRef[] {
  const arr = safeJsonParse<unknown[]>(raw, []);
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const refs: StatusPageMonitorRef[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const monitorId = String(record.monitorId ?? "").trim();
    if (!monitorId || seen.has(monitorId)) continue;
    seen.add(monitorId);
    refs.push({
      monitorId,
      order: refs.length,
      displayName: normalizeDisplayName(record.displayName),
      showUrl: record.showUrl === true,
    });
    if (refs.length >= MAX_MONITORS_PER_PAGE) break;
  }
  return refs;
}

function serializeMonitorRefs(refs: StatusPageMonitorRef[]): string {
  return JSON.stringify(
    refs.map((ref, index) => ({
      monitorId: ref.monitorId,
      order: index,
      displayName: ref.displayName,
      showUrl: ref.showUrl,
    })),
  );
}

/**
 * Build the public-safe monitor projection. This is the security boundary for
 * the anonymous read: it constructs a fresh object with ONLY safe fields and
 * never spreads the raw monitor row, so config/secret fields cannot leak.
 */
export function sanitizePublicMonitor(
  monitor: {
    id: string;
    name: string;
    url: string;
    lastStatus: MonitorStatus | null;
  },
  ref: StatusPageMonitorRef,
  stats: MonitorStats | undefined,
  opts: { showResponseTime: boolean },
): PublicStatusMonitor {
  return {
    id: monitor.id,
    name: ref.displayName?.trim() || monitor.name,
    host: safeHost(monitor.url),
    url: ref.showUrl ? monitor.url : null,
    status: stats?.status ?? monitor.lastStatus ?? null,
    windows: stats?.windows ?? EMPTY_WINDOWS,
    timeline: stats?.timeline ?? [],
    responseSeries: opts.showResponseTime ? (stats?.responseSeries ?? []) : [],
    avgResponseMs: opts.showResponseTime
      ? (stats?.avgResponseMs ?? null)
      : null,
  };
}

/** Raw (owner-scoped) monitor row shape needed to build the public projection. */
export interface PublicMonitorRow {
  id: string;
  name: string;
  url: string;
  lastStatus: MonitorStatus | null;
}

/**
 * Assemble the sanitized public monitor list from the page's ordered refs, the
 * OWNER-SCOPED monitor rows, and the stats map. This is the exclusion boundary:
 * a ref whose monitor row is absent (not owned by the page owner, deleted, or
 * otherwise not returned by the owner-scoped query) is DROPPED — so a page can
 * never surface a monitor that isn't both included AND owned. Pure + unit-tested.
 */
export function assemblePublicMonitors(
  refs: StatusPageMonitorRef[],
  monitorRows: PublicMonitorRow[],
  stats: Map<string, MonitorStats>,
  opts: { showResponseTime: boolean },
): PublicStatusMonitor[] {
  const monitorById = new Map<string, PublicMonitorRow>(
    monitorRows.map((row) => [row.id, row]),
  );
  return refs
    .map((ref) => {
      const monitor = monitorById.get(ref.monitorId);
      if (!monitor) return null;
      return sanitizePublicMonitor(monitor, ref, stats.get(ref.monitorId), {
        showResponseTime: opts.showResponseTime,
      });
    })
    .filter((monitor): monitor is PublicStatusMonitor => monitor != null);
}

export function computeOverallStatus(
  monitors: Pick<PublicStatusMonitor, "status">[],
): OverallStatus {
  if (monitors.length === 0) return "unknown";
  let down = 0;
  let degraded = 0;
  let up = 0;
  for (const monitor of monitors) {
    const tone = statusToTone(monitor.status);
    if (tone === "down") down++;
    else if (tone === "degraded") degraded++;
    else if (tone === "up") up++;
  }
  if (down > 0) return "down";
  if (degraded > 0) return "degraded";
  if (up > 0) return "operational";
  return "unknown";
}

function computeCounts(monitors: Pick<PublicStatusMonitor, "status">[]) {
  const counts = { up: 0, down: 0, degraded: 0, total: monitors.length };
  for (const monitor of monitors) {
    const tone = statusToTone(monitor.status);
    if (tone === "up") counts.up++;
    else if (tone === "down") counts.down++;
    else if (tone === "degraded") counts.degraded++;
  }
  return counts;
}

/** Overall uptime per window = mean of the monitors that have data. */
export function aggregateWindows(windowsList: UptimeWindows[]): UptimeWindows {
  const mean = (key: keyof UptimeWindows): number | null => {
    const values = windowsList
      .map((w) => w[key])
      .filter((v): v is number => v != null);
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  };
  return {
    uptime24h: mean("uptime24h"),
    uptime7d: mean("uptime7d"),
    uptime30d: mean("uptime30d"),
    uptime90d: mean("uptime90d"),
  };
}

// ---------------------------------------------------------------------------
// Row mapping + owner scoping
// ---------------------------------------------------------------------------

function rowToStatusPage(row: any): StatusPage {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description ?? null,
    published: row.published === true || row.published === 1,
    showUptimeBars: row.showUptimeBars === true || row.showUptimeBars === 1,
    showOverallUptime:
      row.showOverallUptime === true || row.showOverallUptime === 1,
    showResponseTime:
      row.showResponseTime === true || row.showResponseTime === 1,
    density: normalizeDensity(row.density),
    alignment: normalizeAlignment(row.alignment),
    monitors: parseStatusPageMonitors(row.monitors),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
  };
}

function pageOwnerWhere(ctx: AccessCtx, id?: string) {
  const table = schema.statusPages;
  const clauses = [
    sql`lower(${table.ownerEmail}) = ${ctx.email.toLowerCase()}`,
    ctx.orgId ? eq(table.orgId, ctx.orgId) : isNull(table.orgId),
  ];
  if (id) clauses.push(eq(table.id, id));
  return and(...clauses);
}

function monitorsOwnerWhere(ctx: AccessCtx) {
  const table = schema.monitors;
  return and(
    sql`lower(${table.ownerEmail}) = ${ctx.email.toLowerCase()}`,
    ctx.orgId ? eq(table.orgId, ctx.orgId) : isNull(table.orgId),
  );
}

/** Keep only monitor refs the caller actually owns; re-number order. */
async function resolveOwnedMonitorRefs(
  ctx: AccessCtx,
  entries: StatusPageMonitorInput[],
): Promise<StatusPageMonitorRef[]> {
  const seen = new Set<string>();
  const requested: StatusPageMonitorRef[] = [];
  for (const entry of entries) {
    const monitorId = String(entry?.monitorId ?? "").trim();
    if (!monitorId || seen.has(monitorId)) continue;
    seen.add(monitorId);
    requested.push({
      monitorId,
      order: requested.length,
      displayName: normalizeDisplayName(entry.displayName),
      showUrl: entry.showUrl === true,
    });
    if (requested.length >= MAX_MONITORS_PER_PAGE) break;
  }
  if (requested.length === 0) return [];

  const db = getDb() as any;
  const ownedRows = await db
    .select({ id: schema.monitors.id })
    .from(schema.monitors)
    .where(
      and(
        monitorsOwnerWhere(ctx),
        inArray(
          schema.monitors.id,
          requested.map((ref) => ref.monitorId),
        ),
      ),
    );
  const owned = new Set<string>(ownedRows.map((row: any) => row.id));
  return requested
    .filter((ref) => owned.has(ref.monitorId))
    .map((ref, index) => ({ ...ref, order: index }));
}

async function slugIsTaken(slug: string, exceptId?: string): Promise<boolean> {
  const db = getDb() as any;
  // Slug is a GLOBAL public namespace (`/status/<slug>`), so uniqueness is
  // checked across all owners intentionally — not owner-scoped.
  // guard:allow-unscoped — global slug uniqueness check for the public URL namespace
  const rows = await db
    .select({ id: schema.statusPages.id })
    .from(schema.statusPages)
    .where(eq(schema.statusPages.slug, slug))
    .limit(2);
  return rows.some((row: any) => row.id !== exceptId);
}

// ---------------------------------------------------------------------------
// Owner-scoped CRUD
// ---------------------------------------------------------------------------

export async function listStatusPages(ctx: AccessCtx): Promise<StatusPage[]> {
  const db = getDb() as any;
  const rows = await db
    .select()
    .from(schema.statusPages)
    .where(pageOwnerWhere(ctx))
    .orderBy(desc(schema.statusPages.updatedAt));
  return rows.map(rowToStatusPage);
}

export async function getStatusPage(
  id: string,
  ctx: AccessCtx,
): Promise<StatusPage | null> {
  const db = getDb() as any;
  const [row] = await db
    .select()
    .from(schema.statusPages)
    .where(pageOwnerWhere(ctx, id))
    .limit(1);
  return row ? rowToStatusPage(row) : null;
}

export async function saveStatusPage(
  input: StatusPageInput,
  ctx: AccessCtx,
): Promise<StatusPage> {
  const db = getDb() as any;
  const updatedAt = nowIso();
  const id = input.id || randomUUID();

  const existing = input.id ? await getStatusPage(input.id, ctx) : null;
  if (input.id && !existing) throw notFound("Status page not found");

  const title = (input.title ?? existing?.title ?? "").trim();
  if (!title) throw badRequest("Status page title is required");

  // Slug: normalize the provided value, else keep the existing one, else derive
  // it from the title (with a short random suffix as a last resort).
  let slug =
    input.slug != null ? normalizeSlug(input.slug) : (existing?.slug ?? "");
  if (!slug) slug = normalizeSlug(title);
  if (!slug) slug = `status-${randomUUID().slice(0, 8)}`;
  if (await slugIsTaken(slug, existing?.id)) {
    throw badRequest(`The slug "${slug}" is already in use`);
  }

  const description =
    input.description !== undefined
      ? input.description
        ? String(input.description).trim().slice(0, MAX_DESCRIPTION_LENGTH)
        : null
      : (existing?.description ?? null);

  const refs =
    input.monitors !== undefined
      ? await resolveOwnedMonitorRefs(ctx, input.monitors)
      : (existing?.monitors ?? []);

  const shared = {
    slug,
    title: title.slice(0, MAX_TITLE_LENGTH),
    description,
    published: input.published ?? existing?.published ?? false,
    showUptimeBars: input.showUptimeBars ?? existing?.showUptimeBars ?? true,
    showOverallUptime:
      input.showOverallUptime ?? existing?.showOverallUptime ?? true,
    showResponseTime:
      input.showResponseTime ?? existing?.showResponseTime ?? false,
    density: normalizeDensity(input.density ?? existing?.density),
    alignment: normalizeAlignment(input.alignment ?? existing?.alignment),
    monitors: serializeMonitorRefs(refs),
  };

  if (existing) {
    await db
      .update(schema.statusPages)
      .set({ ...shared, updatedAt })
      .where(pageOwnerWhere(ctx, id));
  } else {
    const [{ total = 0 } = { total: 0 }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.statusPages)
      .where(pageOwnerWhere(ctx));
    if (Number(total) >= MAX_STATUS_PAGES_PER_OWNER) {
      throw Object.assign(
        new Error(`Status page limit reached (${MAX_STATUS_PAGES_PER_OWNER})`),
        { statusCode: 429 },
      );
    }
    await db.insert(schema.statusPages).values({
      id,
      ...shared,
      createdAt: updatedAt,
      updatedAt,
      ownerEmail: ctx.email,
      orgId: ctx.orgId,
    });
  }

  const saved = await getStatusPage(id, ctx);
  if (!saved) throw new Error("Failed to save status page");
  recordChange({
    source: "status-pages",
    type: "change",
    key: saved.id,
    owner: saved.ownerEmail,
    orgId: saved.orgId ?? undefined,
  });
  return saved;
}

export async function deleteStatusPage(
  id: string,
  ctx: AccessCtx,
): Promise<void> {
  const existing = await getStatusPage(id, ctx);
  if (!existing) throw notFound("Status page not found");
  const db = getDb() as any;
  await db.delete(schema.statusPages).where(pageOwnerWhere(ctx, id));
  recordChange({
    source: "status-pages",
    type: "delete",
    key: id,
    owner: existing.ownerEmail,
    orgId: existing.orgId ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// Monitor membership management
// ---------------------------------------------------------------------------

async function persistMonitorRefs(
  page: StatusPage,
  refs: StatusPageMonitorRef[],
  ctx: AccessCtx,
): Promise<StatusPage> {
  const db = getDb() as any;
  const ordered = refs.map((ref, index) => ({ ...ref, order: index }));
  await db
    .update(schema.statusPages)
    .set({ monitors: serializeMonitorRefs(ordered), updatedAt: nowIso() })
    .where(pageOwnerWhere(ctx, page.id));
  const saved = await getStatusPage(page.id, ctx);
  if (!saved) throw new Error("Failed to update status page monitors");
  recordChange({
    source: "status-pages",
    type: "change",
    key: saved.id,
    owner: saved.ownerEmail,
    orgId: saved.orgId ?? undefined,
  });
  return saved;
}

export async function addStatusPageMonitor(
  pageId: string,
  input: StatusPageMonitorInput,
  ctx: AccessCtx,
): Promise<StatusPage> {
  const page = await getStatusPage(pageId, ctx);
  if (!page) throw notFound("Status page not found");
  const [owned] = await resolveOwnedMonitorRefs(ctx, [input]);
  if (!owned) throw badRequest("Monitor not found");
  if (page.monitors.length >= MAX_MONITORS_PER_PAGE) {
    throw badRequest(
      `A status page can include up to ${MAX_MONITORS_PER_PAGE} monitors`,
    );
  }
  const next = page.monitors.filter((ref) => ref.monitorId !== owned.monitorId);
  next.push(owned);
  return persistMonitorRefs(page, next, ctx);
}

export async function removeStatusPageMonitor(
  pageId: string,
  monitorId: string,
  ctx: AccessCtx,
): Promise<StatusPage> {
  const page = await getStatusPage(pageId, ctx);
  if (!page) throw notFound("Status page not found");
  const next = page.monitors.filter((ref) => ref.monitorId !== monitorId);
  return persistMonitorRefs(page, next, ctx);
}

export async function reorderStatusPageMonitors(
  pageId: string,
  orderedMonitorIds: string[],
  ctx: AccessCtx,
): Promise<StatusPage> {
  const page = await getStatusPage(pageId, ctx);
  if (!page) throw notFound("Status page not found");
  const byId = new Map(page.monitors.map((ref) => [ref.monitorId, ref]));
  const next: StatusPageMonitorRef[] = [];
  for (const id of orderedMonitorIds) {
    const ref = byId.get(id);
    if (ref && !next.includes(ref)) next.push(ref);
  }
  // Append any monitors the caller didn't mention so none are silently dropped.
  for (const ref of page.monitors) {
    if (!next.includes(ref)) next.push(ref);
  }
  return persistMonitorRefs(page, next, ctx);
}

// ---------------------------------------------------------------------------
// View assembly (shared by public read + owner preview)
// ---------------------------------------------------------------------------

async function buildStatusPageView(
  page: StatusPage,
): Promise<PublicStatusPage> {
  const ownerCtx: AccessCtx = { email: page.ownerEmail, orgId: page.orgId };
  const layout = {
    density: page.density,
    alignment: page.alignment,
    showUptimeBars: page.showUptimeBars,
    showOverallUptime: page.showOverallUptime,
    showResponseTime: page.showResponseTime,
  };

  let publicMonitors: PublicStatusMonitor[] = [];
  if (page.monitors.length > 0) {
    const db = getDb() as any;
    const ids = page.monitors.map((ref) => ref.monitorId);
    // Resolve the included monitors scoped strictly to the PAGE OWNER — an
    // anonymous viewer never widens this beyond the owner's own monitors.
    const monitorRows = await db
      .select({
        id: schema.monitors.id,
        name: schema.monitors.name,
        url: schema.monitors.url,
        lastStatus: schema.monitors.lastStatus,
      })
      .from(schema.monitors)
      .where(
        and(monitorsOwnerWhere(ownerCtx), inArray(schema.monitors.id, ids)),
      );
    const ownedIds = new Set<string>(monitorRows.map((row: any) => row.id));
    const ownedIncludedIds = page.monitors
      .filter((ref) => ownedIds.has(ref.monitorId))
      .map((ref) => ref.monitorId);
    const stats = await getMonitorStats(ownerCtx, ownedIncludedIds, {
      timelineDays: TIMELINE_DAYS,
      responseWindowHours: page.showResponseTime
        ? RESPONSE_WINDOW_HOURS_WITH_CHART
        : 24,
    });
    publicMonitors = assemblePublicMonitors(
      page.monitors,
      monitorRows as PublicMonitorRow[],
      stats,
      { showResponseTime: page.showResponseTime },
    );
  }

  return {
    slug: page.slug,
    title: page.title,
    description: page.description,
    layout,
    overall: computeOverallStatus(publicMonitors),
    counts: computeCounts(publicMonitors),
    overallWindows: publicMonitors.length
      ? aggregateWindows(publicMonitors.map((m) => m.windows))
      : EMPTY_WINDOWS,
    monitors: publicMonitors,
    generatedAt: nowIso(),
  };
}

/**
 * UNAUTHENTICATED read by slug. Returns the sanitized public view only for a
 * PUBLISHED page, or null (unknown/unpublished → 404 on the route).
 */
export async function getPublicStatusPage(
  slug: string,
): Promise<PublicStatusPage | null> {
  const normalized = normalizeSlug(slug);
  if (!normalized) return null;
  const db = getDb() as any;
  const table = schema.statusPages;
  // Public viewer endpoint: look up strictly by slug AND published=true. Not
  // owner-scoped by design (there is no authenticated requester); the included
  // monitors are re-scoped to the page owner inside buildStatusPageView.
  // guard:allow-unscoped — public status page viewer; published-only, monitor reads re-scoped to page owner
  const [row] = await db
    .select()
    .from(table)
    .where(and(eq(table.slug, normalized), eq(table.published, true)))
    .limit(1);
  if (!row) return null;
  return buildStatusPageView(rowToStatusPage(row));
}

/**
 * Owner-scoped preview of the exact public view, for the in-app config UI so it
 * can render the same output the public page will show (including unpublished
 * drafts). Returns null when the page isn't owned by the caller.
 */
export async function getStatusPagePreview(
  id: string,
  ctx: AccessCtx,
): Promise<{ page: StatusPage; view: PublicStatusPage } | null> {
  const page = await getStatusPage(id, ctx);
  if (!page) return null;
  const view = await buildStatusPageView(page);
  return { page, view };
}
