/**
 * What one dashboard save changed, as typed items rather than prose: the
 * server stores them on the revision the save leaves behind, and the History
 * panel, the save toast, and agents each word them for their reader.
 */
export type DashboardChange =
  | { kind: "version-restored" }
  | { kind: "dashboard-renamed"; from: string; to: string }
  | { kind: "description-changed" }
  | { kind: "panel-added"; title: string | null }
  | { kind: "panel-removed"; title: string | null }
  | { kind: "panel-renamed"; from: string; to: string }
  | { kind: "panel-query-changed"; title: string | null }
  | { kind: "panel-display-changed"; title: string | null }
  | {
      kind: "column-resized";
      title: string | null;
      columns: number;
      /** Set only when one column changed between two known widths. */
      direction: "wider" | "narrower" | null;
    }
  | { kind: "columns-changed"; title: string | null }
  | { kind: "panel-resized"; title: string | null }
  | { kind: "layout-changed" }
  | { kind: "filter-added"; label: string }
  | { kind: "filter-removed"; label: string }
  | { kind: "filter-changed"; label: string }
  | { kind: "other" };

export type DashboardChangeKind = DashboardChange["kind"];

export interface DashboardChangeSummary {
  changes: DashboardChange[];
  /** Changes left out of `changes` by the storage cap. */
  omitted: number;
}

export type DashboardChangeSummaryStatus = "absent" | "valid" | "unreadable";

export type ParsedDashboardChangeSummary =
  | { status: "absent" }
  | { status: "valid"; summary: DashboardChangeSummary }
  | { status: "unreadable" };

export const MAX_STORED_DASHBOARD_CHANGES = 8;
const MAX_NAME_LENGTH = 120;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Configs arrive both from JSON and from client state, where an unset field
// is often `undefined`; the two must compare equal.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => sameValue(item, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!sameValue(a[key], b[key])) return false;
  }
  return true;
}

function changedKeys(
  before: JsonRecord,
  after: JsonRecord,
  ignore: ReadonlySet<string> = new Set(),
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (key) => !ignore.has(key) && !sameValue(before[key], after[key]),
  );
}

function shortName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > MAX_NAME_LENGTH
    ? `${trimmed.slice(0, MAX_NAME_LENGTH - 1)}…`
    : trimmed;
}

function nameOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? shortName(value) : null;
}

/** Null when the two names read the same once shortened (spacing, say). */
function renamed(
  before: unknown,
  after: unknown,
): { from: string; to: string } | null {
  const from = nameOf(before);
  const to = nameOf(after);
  return from && to && from !== to ? { from, to } : null;
}

function dashboardName(config: JsonRecord): unknown {
  return config.name ?? config.title;
}

/** Records keyed by a unique string field, or null when the list can't be. */
function indexById(
  value: unknown,
  idKey: string,
): { order: string[]; byId: Map<string, JsonRecord> } | null {
  if (value === undefined) return { order: [], byId: new Map() };
  if (!Array.isArray(value)) return null;
  const byId = new Map<string, JsonRecord>();
  for (const item of value) {
    if (!isRecord(item) || typeof item[idKey] !== "string") return null;
    if (byId.has(item[idKey])) return null;
    byId.set(item[idKey], item);
  }
  return { order: [...byId.keys()], byId };
}

function panelList(config: JsonRecord): unknown {
  return config.panels ?? config.charts;
}

const PANEL_QUERY_FIELDS = new Set(["sql", "source", "configId"]);
const PANEL_LAYOUT_FIELDS = new Set(["width", "tab", "columns"]);
const PANEL_DISPLAY_FIELDS = new Set(["chartType"]);
const PANEL_CONFIG_QUERY_FIELDS = new Set(["timeScope"]);

function describeColumns(
  before: unknown,
  after: unknown,
): { resized: number; direction: "wider" | "narrower" | null; other: boolean } {
  const result = {
    resized: 0,
    direction: null as "wider" | "narrower" | null,
    other: false,
  };
  const beforeColumns = indexById(before, "key");
  const afterColumns = indexById(after, "key");
  if (!beforeColumns || !afterColumns) {
    result.other = true;
    return result;
  }
  // The table header fills an unlisted column from the query's keys the first
  // time it is edited, so a new entry counts as a change only in what it sets.
  let lastDirection: "wider" | "narrower" | null = null;
  for (const key of afterColumns.order) {
    const next = afterColumns.byId.get(key)!;
    const previous = beforeColumns.byId.get(key) ?? { key };
    if (!sameValue(previous.width, next.width)) {
      result.resized += 1;
      lastDirection =
        typeof previous.width === "number" && typeof next.width === "number"
          ? next.width > previous.width
            ? "wider"
            : "narrower"
          : null;
    }
    if (changedKeys(previous, next, new Set(["width"])).length > 0) {
      result.other = true;
    }
  }
  const kept = beforeColumns.order.filter((key) => afterColumns.byId.has(key));
  if (kept.length !== beforeColumns.order.length) result.other = true;
  const keptAfter = afterColumns.order.filter((key) =>
    beforeColumns.byId.has(key),
  );
  if (!sameValue(kept, keptAfter)) result.other = true;
  result.direction = result.resized === 1 ? lastDirection : null;
  return result;
}

function describePanel(
  before: JsonRecord,
  after: JsonRecord,
  changes: DashboardChange[],
): { other: boolean } {
  const title = nameOf(after.title);
  let other = false;
  let query = false;
  let display = false;
  const fields = changedKeys(before, after, PANEL_LAYOUT_FIELDS);
  for (const field of fields) {
    if (field === "id") continue;
    if (field === "title") {
      const rename = renamed(before.title, after.title);
      if (rename) changes.push({ kind: "panel-renamed", ...rename });
      else other = true;
    } else if (PANEL_QUERY_FIELDS.has(field)) query = true;
    else if (PANEL_DISPLAY_FIELDS.has(field)) display = true;
    else if (field !== "config") other = true;
  }

  let columns: ReturnType<typeof describeColumns> | null = null;
  if (fields.includes("config")) {
    const beforeConfig = before.config ?? {};
    const afterConfig = after.config ?? {};
    if (!isRecord(beforeConfig) || !isRecord(afterConfig)) {
      display = true;
    } else {
      for (const field of changedKeys(beforeConfig, afterConfig)) {
        if (PANEL_CONFIG_QUERY_FIELDS.has(field)) query = true;
        else if (field === "columns") {
          columns = describeColumns(beforeConfig.columns, afterConfig.columns);
        } else display = true;
      }
    }
  }

  if (query) changes.push({ kind: "panel-query-changed", title });
  if (display) changes.push({ kind: "panel-display-changed", title });
  if (columns?.resized) {
    changes.push({
      kind: "column-resized",
      title,
      columns: columns.resized,
      direction: columns.direction,
    });
  }
  if (columns?.other) changes.push({ kind: "columns-changed", title });
  return { other };
}

function describePanels(
  before: JsonRecord,
  after: JsonRecord,
  changes: DashboardChange[],
): { other: boolean } {
  const beforeList = panelList(before);
  const afterList = panelList(after);
  if (sameValue(beforeList, afterList)) {
    if (!sameValue(before.columns, after.columns)) {
      changes.push({ kind: "layout-changed" });
    }
    return { other: false };
  }
  const beforePanels = indexById(beforeList, "id");
  const afterPanels = indexById(afterList, "id");
  if (!beforePanels || !afterPanels) return { other: true };

  let other = false;
  let addedOrRemoved = false;
  for (const id of afterPanels.order) {
    const next = afterPanels.byId.get(id)!;
    const previous = beforePanels.byId.get(id);
    if (!previous) {
      addedOrRemoved = true;
      changes.push({ kind: "panel-added", title: nameOf(next.title) });
      continue;
    }
    if (describePanel(previous, next, changes).other) other = true;
  }
  for (const id of beforePanels.order) {
    if (afterPanels.byId.has(id)) continue;
    addedOrRemoved = true;
    changes.push({
      kind: "panel-removed",
      title: nameOf(beforePanels.byId.get(id)!.title),
    });
  }

  const kept = beforePanels.order.filter((id) => afterPanels.byId.has(id));
  const keptAfter = afterPanels.order.filter((id) => beforePanels.byId.has(id));
  let rearranged =
    !sameValue(kept, keptAfter) || !sameValue(before.columns, after.columns);
  const resized: string[] = [];
  for (const id of kept) {
    const previous = beforePanels.byId.get(id)!;
    const next = afterPanels.byId.get(id)!;
    if (
      !sameValue(previous.tab, next.tab) ||
      !sameValue(previous.columns, next.columns)
    ) {
      rearranged = true;
    }
    if (!sameValue(previous.width, next.width)) resized.push(id);
  }
  // Adding, removing or moving a panel rebalances the widths of every row it
  // leaves or joins (`rebalanceRowWidths`), so width changes alongside one are
  // the reflow, not a resize anyone asked for.
  if (rearranged) {
    changes.push({ kind: "layout-changed" });
  } else if (!addedOrRemoved) {
    for (const id of resized) {
      changes.push({
        kind: "panel-resized",
        title: nameOf(afterPanels.byId.get(id)!.title),
      });
    }
  }
  return { other };
}

function filterLabel(filter: JsonRecord): string {
  return nameOf(filter.label) ?? shortName(String(filter.id));
}

function describeFilters(
  before: unknown,
  after: unknown,
  changes: DashboardChange[],
): { other: boolean } {
  if (sameValue(before, after)) return { other: false };
  const beforeFilters = indexById(before, "id");
  const afterFilters = indexById(after, "id");
  if (!beforeFilters || !afterFilters) return { other: true };
  for (const id of afterFilters.order) {
    const next = afterFilters.byId.get(id)!;
    const previous = beforeFilters.byId.get(id);
    if (!previous) {
      changes.push({ kind: "filter-added", label: filterLabel(next) });
    } else if (!sameValue(previous, next)) {
      changes.push({ kind: "filter-changed", label: filterLabel(next) });
    }
  }
  for (const id of beforeFilters.order) {
    if (afterFilters.byId.has(id)) continue;
    changes.push({
      kind: "filter-removed",
      label: filterLabel(beforeFilters.byId.get(id)!),
    });
  }
  const kept = beforeFilters.order.filter((id) => afterFilters.byId.has(id));
  const keptAfter = afterFilters.order.filter((id) =>
    beforeFilters.byId.has(id),
  );
  return { other: !sameValue(kept, keptAfter) };
}

const DESCRIBED_DASHBOARD_FIELDS = new Set([
  "name",
  "title",
  "description",
  "panels",
  "charts",
  "columns",
  "filters",
]);

/**
 * Every change from `before` to `after`, most specific first: the dashboard's
 * name and description, then each panel in its new order, removed panels,
 * the layout, filters, and one trailing `other` for anything else. Identical
 * configs give an empty list; differing configs never do.
 */
export function describeDashboardChanges(
  before: unknown,
  after: unknown,
): DashboardChange[] {
  if (sameValue(before, after)) return [];
  if (!isRecord(before) || !isRecord(after)) return [{ kind: "other" }];

  const changes: DashboardChange[] = [];
  let other = false;

  if (!sameValue(dashboardName(before), dashboardName(after))) {
    const rename = renamed(dashboardName(before), dashboardName(after));
    if (rename) changes.push({ kind: "dashboard-renamed", ...rename });
    else other = true;
  }
  if (!sameValue(before.description, after.description)) {
    changes.push({ kind: "description-changed" });
  }
  if (describePanels(before, after, changes).other) other = true;
  if (describeFilters(before.filters, after.filters, changes).other) {
    other = true;
  }
  if (changedKeys(before, after, DESCRIBED_DASHBOARD_FIELDS).length > 0) {
    other = true;
  }
  if (other || changes.length === 0) changes.push({ kind: "other" });
  return changes;
}

/**
 * What a write stores. A write always changed something, even when its config
 * didn't (a kind change, say), so the stored list is never empty.
 */
export function summarizeDashboardChanges(
  described: DashboardChange[],
): DashboardChangeSummary {
  const changes: DashboardChange[] =
    described.length > 0 ? described : [{ kind: "other" }];
  return {
    changes: changes.slice(0, MAX_STORED_DASHBOARD_CHANGES),
    omitted: Math.max(0, changes.length - MAX_STORED_DASHBOARD_CHANGES),
  };
}

const NAMED_PANEL_KINDS = new Set<DashboardChangeKind>([
  "panel-added",
  "panel-removed",
  "panel-query-changed",
  "panel-display-changed",
  "columns-changed",
  "panel-resized",
]);
const FILTER_KINDS = new Set<DashboardChangeKind>([
  "filter-added",
  "filter-removed",
  "filter-changed",
]);
const BARE_KINDS = new Set<DashboardChangeKind>([
  "version-restored",
  "description-changed",
  "layout-changed",
  "other",
]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isDashboardChange(value: unknown): value is DashboardChange {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  const kind = value.kind as DashboardChangeKind;
  if (BARE_KINDS.has(kind)) return true;
  if (NAMED_PANEL_KINDS.has(kind)) return isNullableString(value.title);
  if (FILTER_KINDS.has(kind)) return typeof value.label === "string";
  if (kind === "dashboard-renamed" || kind === "panel-renamed") {
    return typeof value.from === "string" && typeof value.to === "string";
  }
  if (kind === "column-resized") {
    return (
      isNullableString(value.title) &&
      typeof value.columns === "number" &&
      Number.isInteger(value.columns) &&
      value.columns > 0 &&
      (value.direction === null ||
        value.direction === "wider" ||
        value.direction === "narrower")
    );
  }
  return false;
}

/**
 * Reads a stored summary. Rows saved before summaries existed have none
 * ("absent"); a stored value that is not a well-formed summary, including one
 * naming a kind this code doesn't know or listing no change, is "unreadable",
 * never an empty list.
 */
export function parseDashboardChangeSummary(
  raw: unknown,
): ParsedDashboardChangeSummary {
  if (raw == null) return { status: "absent" };
  if (typeof raw !== "string") return { status: "unreadable" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "unreadable" };
  }
  if (
    !isRecord(value) ||
    !Array.isArray(value.changes) ||
    value.changes.length === 0 ||
    typeof value.omitted !== "number" ||
    !Number.isInteger(value.omitted) ||
    value.omitted < 0 ||
    !value.changes.every(isDashboardChange)
  ) {
    return { status: "unreadable" };
  }
  return {
    status: "valid",
    summary: {
      changes: value.changes as DashboardChange[],
      omitted: value.omitted,
    },
  };
}
