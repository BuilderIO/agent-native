export type FactoryAuditEventRecord = {
  id: string;
  itemId: string | null;
  source: string | null;
  sourceUrl: string | null;
  action: string;
  kind: string;
  status: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type FactoryAuditItemSnapshot = {
  id: string;
  title: string;
  summary: string | null;
  source: string | null;
  sourceUrl: string | null;
  status?: string | null;
  createdAt?: string | null;
  lastSeenAt?: string | null;
  slackBuilderReplyAt?: string | null;
  slackDisposition?: string | null;
  userLabels?: Record<string, string>;
};

export type FactoryAuditRunSnapshot = {
  itemId: string;
  status: string;
  error: string | null;
  provider: string | null;
  startedAt: string;
};

export type FactoryAuditItemOutcome =
  | "held"
  | "dispatched"
  | "failed"
  | "inspected"
  | "left";

export type FactoryAuditReportItem = {
  itemId: string;
  source: string | null;
  sourceUrl: string | null;
  title: string;
  summary: string | null;
  outcome: FactoryAuditItemOutcome;
  status: string;
  rationale: string | null;
  dispatchError: string | null;
  clearBug: boolean | null;
  productUx: boolean | null;
  ownerArea: string | null;
  guards: string | null;
  events: FactoryAuditEventRecord[];
  latestAt: string;
  listedStatus: string | null;
  firstSeenThisRun: boolean;
  builderAlreadyStarted: boolean;
  userLabels?: Record<string, string>;
};

export type FactoryAuditTraceStep = {
  id: string;
  action: string;
  summary: string;
  status: string;
  createdAt: string;
  count: number;
  purpose: string | null;
};

export type FactoryAuditCounts = {
  newlyObserved: number;
  scanned: number;
  investigated: number;
  held: number;
  dispatched: number;
  failed: number;
  added: number;
  listed: number;
  left: number;
  inboxLimit: number | null;
  workLimit: number | null;
  authorFiltered: number | null;
  updated: number | null;
};

export type FactoryAuditReport = {
  counts: FactoryAuditCounts;
  inbox: FactoryAuditReportItem[];
  work: FactoryAuditReportItem[];
  actions: FactoryAuditReportItem[];
  items: FactoryAuditReportItem[];
  trace: FactoryAuditTraceStep[];
};

const INVESTIGATE_ACTIONS = new Set([
  "get-slack-feedback-context",
  "get-triage-item",
]);

export function projectFactoryAuditReport(
  events: FactoryAuditEventRecord[],
  items: FactoryAuditItemSnapshot[] = [],
  runs: FactoryAuditRunSnapshot[] = [],
  window?: { startedAt: number; finishedAt: number | null },
): FactoryAuditReport {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const latestRunByItem = latestRunsByItem(
    window ? runsInWindow(runs, window) : runs,
  );
  const chronological = [...events].sort(byCreatedAtAsc);
  const listed = listedItemSnapshots(chronological);
  const inboxIds = inboxItemIds(chronological);
  const addedCount = readAddedCount(chronological, inboxIds.size);
  const pollRollup = pollRollupEvent(chronological);
  const listEvent = reviewListEvent(chronological);

  const primaryItemIds = new Set<string>([...listed.keys(), ...inboxIds]);
  for (const event of chronological) {
    if (!event.itemId) continue;
    if (
      INVESTIGATE_ACTIONS.has(event.action) ||
      event.kind === "decision" ||
      event.kind === "external_action"
    ) {
      primaryItemIds.add(event.itemId);
    }
  }

  const reportItems = [...primaryItemIds]
    .map((itemId) =>
      projectItem(
        itemId,
        chronological.filter(
          (event) => event.itemId === itemId && !isScanEvent(event),
        ),
        itemsById.get(itemId),
        latestRunByItem.get(itemId),
        listed.get(itemId) ?? null,
        inboxIds.has(itemId),
        window,
      ),
    )
    .sort(
      (left, right) =>
        new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime(),
    );
  const itemsByReportId = new Map(
    reportItems.map((item) => [item.itemId, item]),
  );
  const work = [...listed.keys()]
    .map((itemId) => itemsByReportId.get(itemId))
    .filter((item): item is FactoryAuditReportItem => Boolean(item));
  const inbox = [...inboxIds]
    .map((itemId) => itemsByReportId.get(itemId))
    .filter((item): item is FactoryAuditReportItem => Boolean(item));
  const actions = reportItems.filter(
    (item) => item.outcome === "dispatched" || item.outcome === "failed",
  );
  const investigated = reportItems.filter((item) => item.outcome !== "left");

  const counts: FactoryAuditCounts = {
    newlyObserved: addedCount,
    scanned: listed.size > 0 ? listed.size : scannedItemCount(chronological),
    investigated: investigated.length,
    held: reportItems.filter((item) => item.outcome === "held").length,
    dispatched: reportItems.filter((item) => item.outcome === "dispatched")
      .length,
    failed: reportItems.filter((item) => item.outcome === "failed").length,
    added: addedCount,
    listed: listed.size,
    left: reportItems.filter((item) => item.outcome === "left").length,
    inboxLimit: readNumberDetail(pollRollup?.details, "inboxLimit"),
    workLimit: readNumberDetail(listEvent?.details, "limit"),
    authorFiltered: readNumberDetail(pollRollup?.details, "authorFiltered"),
    updated: readNumberDetail(pollRollup?.details, "updated"),
  };

  return {
    counts,
    inbox,
    work,
    actions,
    items: work.length > 0 ? work : investigated,
    trace: collapseTrace(chronological),
  };
}

function projectItem(
  itemId: string,
  events: FactoryAuditEventRecord[],
  item: FactoryAuditItemSnapshot | undefined,
  run: FactoryAuditRunSnapshot | undefined,
  listed: ListedItemSnapshot | null,
  addedThisRun: boolean,
  window?: { startedAt: number; finishedAt: number | null },
): FactoryAuditReportItem {
  const decision = events.find((event) => event.kind === "decision") ?? null;
  const dispatch =
    events.find((event) => event.kind === "external_action") ?? null;
  const latestAt = events.reduce(
    (latest, event) =>
      new Date(event.createdAt).getTime() > new Date(latest).getTime()
        ? event.createdAt
        : latest,
    events[0]?.createdAt ?? item?.createdAt ?? new Date(0).toISOString(),
  );
  const dispatchError = readDispatchError(dispatch, run);
  const opened = events.some((event) => INVESTIGATE_ACTIONS.has(event.action));
  let outcome = itemOutcome(decision, dispatch, dispatchError);
  if (outcome === "inspected" && listed && !opened) outcome = "left";
  const firstSeenThisRun =
    addedThisRun || createdDuringWindow(item?.createdAt, window);
  const listedStatus = listed?.status ?? item?.status ?? null;
  const builderAlreadyStarted =
    listedStatus === "automation_started" ||
    Boolean(item?.slackBuilderReplyAt) ||
    Boolean(item?.slackDisposition) ||
    startedBeforeWindow(run, window);

  return {
    itemId,
    source: item?.source ?? events[0]?.source ?? null,
    sourceUrl:
      item?.sourceUrl ??
      events.find((event) => event.sourceUrl)?.sourceUrl ??
      null,
    title: auditItemSubject(item, events),
    summary: auditItemMessage(item, events),
    outcome,
    status:
      outcome === "failed"
        ? "error"
        : outcome === "held" || outcome === "left"
          ? "skipped"
          : "success",
    rationale: decision?.summary ?? dispatch?.summary ?? null,
    dispatchError,
    clearBug: readBooleanDetail(decision?.details, "clearBug"),
    productUx: readBooleanDetail(decision?.details, "productUxImplications"),
    ownerArea: readStringDetail(decision?.details, "ownerOwnedArea"),
    guards: readGuardSummary(decision?.details?.guardResults),
    events,
    latestAt,
    listedStatus,
    firstSeenThisRun,
    builderAlreadyStarted,
    userLabels: item?.userLabels,
  };
}

function itemOutcome(
  decision: FactoryAuditEventRecord | null,
  dispatch: FactoryAuditEventRecord | null,
  dispatchError: string | null,
): FactoryAuditItemOutcome {
  if (dispatchError) return "failed";
  if (dispatch?.status === "error") return "failed";
  if (dispatch) return "dispatched";
  if (decision?.status === "skipped") return "held";
  if (decision) return "held";
  return "inspected";
}

type ListedItemSnapshot = {
  status: string | null;
  outcome: string | null;
};

function listedItemSnapshots(
  events: FactoryAuditEventRecord[],
): Map<string, ListedItemSnapshot> {
  const listed = new Map<string, ListedItemSnapshot>();
  for (const event of events) {
    if (event.action !== "list-triage-items") continue;
    const rows = event.details.listedItems;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const itemId = (row as { itemId?: unknown }).itemId;
        if (typeof itemId !== "string" || !itemId) continue;
        const status = (row as { status?: unknown }).status;
        const outcome = (row as { outcome?: unknown }).outcome;
        listed.set(itemId, {
          status: typeof status === "string" && status ? status : null,
          outcome: typeof outcome === "string" && outcome ? outcome : null,
        });
      }
      continue;
    }
    for (const itemId of eventItemIds(event)) {
      if (!listed.has(itemId)) {
        listed.set(itemId, { status: null, outcome: null });
      }
    }
  }
  return listed;
}

function pollRollupEvent(
  events: FactoryAuditEventRecord[],
): FactoryAuditEventRecord | null {
  return (
    events.find(
      (event) =>
        isPollEvent(event) &&
        !event.itemId &&
        (typeof event.details.inboxLimit === "number" ||
          typeof event.details.added === "number" ||
          typeof event.details.newlyObserved === "number"),
    ) ??
    events.find((event) => isPollEvent(event) && !event.itemId) ??
    null
  );
}

function reviewListEvent(
  events: FactoryAuditEventRecord[],
): FactoryAuditEventRecord | null {
  const lists = events.filter((event) => event.action === "list-triage-items");
  return (
    [...lists].reverse().find((event) => event.details.needsReview === true) ??
    lists[lists.length - 1] ??
    null
  );
}

function inboxItemIds(events: FactoryAuditEventRecord[]): Set<string> {
  const ids = new Set<string>();
  const rollup = pollRollupEvent(events);
  if (rollup) {
    for (const itemId of eventItemIds(rollup)) ids.add(itemId);
  }
  for (const event of events) {
    if (!isPollEvent(event) || !event.itemId) continue;
    if (isEmptyObservation(event)) continue;
    ids.add(event.itemId);
  }
  return ids;
}

function readAddedCount(
  events: FactoryAuditEventRecord[],
  fallback: number,
): number {
  const rollup = pollRollupEvent(events);
  const added = readNumberDetail(rollup?.details, "added");
  if (added !== null) return added;
  const newlyObserved = readNumberDetail(rollup?.details, "newlyObserved");
  if (newlyObserved !== null) return newlyObserved;
  return fallback;
}

function readNumberDetail(
  details: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const value = details?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function createdDuringWindow(
  createdAt: string | null | undefined,
  window?: { startedAt: number; finishedAt: number | null },
): boolean {
  if (!createdAt || !window) return false;
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return false;
  const start = window.startedAt - 5_000;
  const end = (window.finishedAt ?? Date.now()) + 5_000;
  return at >= start && at <= end;
}

function startedBeforeWindow(
  run: FactoryAuditRunSnapshot | undefined,
  window?: { startedAt: number; finishedAt: number | null },
): boolean {
  if (!run || !window) return Boolean(run);
  const at = Date.parse(run.startedAt);
  if (!Number.isFinite(at)) return false;
  return at < window.startedAt - 5_000;
}

function readDispatchError(
  dispatch: FactoryAuditEventRecord | null,
  run: FactoryAuditRunSnapshot | undefined,
): string | null {
  if (dispatch?.status === "error") {
    return dispatch.summary.trim() || run?.error || "Dispatch failed.";
  }
  if (run?.status === "failed" && run.error) return run.error;
  return null;
}

export function auditItemSubject(
  item: FactoryAuditItemSnapshot | undefined,
  events: FactoryAuditEventRecord[],
): string {
  const storedSummary = readStoredFeedbackText(item, events);
  if (storedSummary) return firstLine(storedSummary, 110);

  const storedTitle = item?.title?.trim() ?? "";
  if (storedTitle && !isGenericSlackTitle(storedTitle)) return storedTitle;

  const listed = events.find((event) => event.action === "list-triage-items");
  const listedTitle = listed?.summary.trim() ?? "";
  if (listedTitle && !isGenericSlackTitle(listedTitle)) return listedTitle;

  return storedTitle || "Item";
}

export function auditItemMessage(
  item: FactoryAuditItemSnapshot | undefined,
  events: FactoryAuditEventRecord[],
): string | null {
  return readStoredFeedbackText(item, events);
}

function readStoredFeedbackText(
  item: FactoryAuditItemSnapshot | undefined,
  events: FactoryAuditEventRecord[],
): string | null {
  const observed = events.find(
    (event) =>
      isPollEvent(event) && event.summary.trim() && !isEmptyObservation(event),
  )?.summary;
  const detailSummary = events
    .map((event) => readStringDetail(event.details, "itemSummary"))
    .find((value): value is string => Boolean(value));
  const stored =
    item?.summary?.trim() || detailSummary?.trim() || observed?.trim() || "";
  return stored || null;
}

function collapseTrace(
  events: FactoryAuditEventRecord[],
): FactoryAuditTraceStep[] {
  const steps: FactoryAuditTraceStep[] = [];
  const scanGroups = new Map<string, FactoryAuditEventRecord[]>();

  for (const event of events) {
    if (isScanEvent(event)) {
      const purpose = readStringDetail(event.details, "purpose") ?? "scan";
      const bucket = event.createdAt.slice(0, 19);
      const key = `${purpose}:${bucket}`;
      const current = scanGroups.get(key) ?? [];
      current.push(event);
      scanGroups.set(key, current);
      continue;
    }
    if (isPollEvent(event)) {
      if (event.itemId && !isEmptyObservation(event)) continue;
      steps.push({
        id: event.id,
        action: event.action,
        summary: event.summary,
        status: event.status,
        createdAt: event.createdAt,
        count: event.itemId ? 1 : 0,
        purpose: null,
      });
    }
  }

  for (const group of scanGroups.values()) {
    const first = group[0]!;
    const itemIds = new Set<string>();
    for (const event of group) {
      for (const itemId of eventItemIds(event)) itemIds.add(itemId);
    }
    const purpose = readStringDetail(first.details, "purpose");
    const count =
      typeof first.details.count === "number"
        ? first.details.count
        : itemIds.size;
    steps.push({
      id: first.id,
      action: first.action,
      summary:
        group.length === 1 && !first.itemId
          ? first.summary
          : `Loaded ${count} item${count === 1 ? "" : "s"}.`,
      status: first.status,
      createdAt: first.createdAt,
      count,
      purpose,
    });
  }

  return steps.sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

function scannedItemCount(events: FactoryAuditEventRecord[]): number {
  const ids = new Set<string>();
  for (const event of events) {
    if (!isScanEvent(event)) continue;
    for (const itemId of eventItemIds(event)) ids.add(itemId);
  }
  return ids.size;
}

function eventItemIds(event: FactoryAuditEventRecord): string[] {
  if (event.itemId) return [event.itemId];
  const raw = event.details.itemIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function uniqueItemIds(events: FactoryAuditEventRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    for (const itemId of eventItemIds(event)) ids.add(itemId);
  }
  return ids;
}

function latestRunsByItem(
  runs: FactoryAuditRunSnapshot[],
): Map<string, FactoryAuditRunSnapshot> {
  const latest = new Map<string, FactoryAuditRunSnapshot>();
  for (const run of runs) {
    const current = latest.get(run.itemId);
    if (
      !current ||
      new Date(run.startedAt).getTime() > new Date(current.startedAt).getTime()
    ) {
      latest.set(run.itemId, run);
    }
  }
  return latest;
}

function runsInWindow(
  runs: FactoryAuditRunSnapshot[],
  window: { startedAt: number; finishedAt: number | null },
): FactoryAuditRunSnapshot[] {
  const start = window.startedAt - 5_000;
  const end = (window.finishedAt ?? Date.now()) + 5_000;
  return runs.filter((run) => {
    const at = new Date(run.startedAt).getTime();
    return at >= start && at <= end;
  });
}

function isScanEvent(event: FactoryAuditEventRecord): boolean {
  return event.action === "list-triage-items";
}

function isPollEvent(event: FactoryAuditEventRecord): boolean {
  return (
    event.kind === "observed" ||
    event.action.startsWith("poll-") ||
    event.action === "ingest-github-observation"
  );
}

function isEmptyObservation(event: FactoryAuditEventRecord): boolean {
  return /no new|no open|no result/i.test(event.summary);
}

function isGenericSlackTitle(value: string): boolean {
  return /^Slack (user|bot)\b/i.test(value.trim());
}

function firstLine(value: string, maxLength: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}

function byCreatedAtAsc(
  left: FactoryAuditEventRecord,
  right: FactoryAuditEventRecord,
): number {
  return (
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}

function readBooleanDetail(
  details: Record<string, unknown> | undefined,
  key: string,
): boolean | null {
  const value = details?.[key];
  return typeof value === "boolean" ? value : null;
}

function readStringDetail(
  details: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = details?.[key];
  return typeof value === "string" && value ? value : null;
}

function readGuardSummary(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const passed = value.filter(
    (guard): guard is { passed: boolean } =>
      typeof guard === "object" &&
      guard !== null &&
      "passed" in guard &&
      typeof (guard as { passed: unknown }).passed === "boolean" &&
      (guard as { passed: boolean }).passed,
  ).length;
  return `${passed}/${value.length} passed`;
}
