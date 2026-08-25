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
  | "inspected";

export type FactoryAuditReportItem = {
  itemId: string;
  source: string | null;
  sourceUrl: string | null;
  title: string;
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
};

export type FactoryAuditReport = {
  counts: FactoryAuditCounts;
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

  const primaryItemIds = new Set<string>();
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
      ),
    )
    .sort(
      (left, right) =>
        new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime(),
    );

  const counts: FactoryAuditCounts = {
    newlyObserved: uniqueItemIds(
      chronological.filter((event) => isPollEvent(event) && event.itemId),
    ).size,
    scanned: scannedItemCount(chronological),
    investigated: reportItems.length,
    held: reportItems.filter((item) => item.outcome === "held").length,
    dispatched: reportItems.filter((item) => item.outcome === "dispatched")
      .length,
    failed: reportItems.filter((item) => item.outcome === "failed").length,
  };

  return {
    counts,
    items: reportItems,
    trace: collapseTrace(chronological),
  };
}

function projectItem(
  itemId: string,
  events: FactoryAuditEventRecord[],
  item: FactoryAuditItemSnapshot | undefined,
  run: FactoryAuditRunSnapshot | undefined,
): FactoryAuditReportItem {
  const decision = events.find((event) => event.kind === "decision") ?? null;
  const dispatch =
    events.find((event) => event.kind === "external_action") ?? null;
  const latestAt = events.reduce(
    (latest, event) =>
      new Date(event.createdAt).getTime() > new Date(latest).getTime()
        ? event.createdAt
        : latest,
    events[0]?.createdAt ?? new Date(0).toISOString(),
  );
  const dispatchError = readDispatchError(dispatch, run);
  const outcome = itemOutcome(decision, dispatch, dispatchError);

  return {
    itemId,
    source: item?.source ?? events[0]?.source ?? null,
    sourceUrl:
      item?.sourceUrl ??
      events.find((event) => event.sourceUrl)?.sourceUrl ??
      null,
    title: auditItemSubject(item, events),
    outcome,
    status:
      outcome === "failed"
        ? "error"
        : outcome === "held"
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
  const observed = events.find(
    (event) =>
      isPollEvent(event) && event.summary.trim() && !isEmptyObservation(event),
  )?.summary;
  const detailSummary = events
    .map((event) => readStringDetail(event.details, "itemSummary"))
    .find((value): value is string => Boolean(value));
  const storedSummary =
    item?.summary?.trim() || detailSummary?.trim() || observed?.trim() || "";
  if (storedSummary) return firstLine(storedSummary, 110);

  const storedTitle = item?.title?.trim() ?? "";
  if (storedTitle && !isGenericSlackTitle(storedTitle)) return storedTitle;

  const listed = events.find((event) => event.action === "list-triage-items");
  const listedTitle = listed?.summary.trim() ?? "";
  if (listedTitle && !isGenericSlackTitle(listedTitle)) return listedTitle;

  return storedTitle || "Item";
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
