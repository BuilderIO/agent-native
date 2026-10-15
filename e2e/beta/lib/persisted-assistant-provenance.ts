const LIMIT = {
  roots: 256,
  snapshots: 256,
  events: 2_048,
  runs: 256,
  text: 65_536,
  parts: 128,
} as const;

const STATUS = new Set([
  "complete",
  "completed",
  "streaming",
  "running",
  "queued",
  "in_progress",
  "incomplete",
  "error",
  "failed",
  "cancelled",
]);

type State = "present" | "absent" | "unreadable";
type Status =
  | "complete"
  | "completed"
  | "streaming"
  | "running"
  | "queued"
  | "in_progress"
  | "incomplete"
  | "error"
  | "failed"
  | "cancelled"
  | "unknown";
type Reason =
  | "none"
  | "invalid-json"
  | "response-shape"
  | "messages-shape"
  | "unknown";

export interface ProvenanceScan {
  state: State;
  total: number;
  scanned: number;
  truncated: boolean;
  unreadable: boolean;
  unreadableCount: number;
  ambiguousIdCount: number;
}

export interface ProvenanceMessageScan extends ProvenanceScan {
  assistantsScanned: number;
  assistantsTruncated: boolean;
}

export interface SnapshotAssistantProvenance {
  ordinal: number;
  messageIdPresent: boolean;
  messageIdAmbiguous: boolean;
  runIdPresent: boolean;
  runIdAmbiguous: boolean;
  textPresent: boolean;
  textLength: number;
  textTruncated: boolean;
  textUnreadable: boolean;
  partsTotal: number;
  partsScanned: number;
  partsTruncated: boolean;
  partsUnreadable: boolean;
  rootMessageIdMatchCount: number;
  submittedUserInferredRootRunMatchCount: number;
  nativeServerRunRootMessageIdMatchCount: number;
  anyEventReferenceCount: number;
  otherEventSameRunRootMatchCount: number;
  rootAgentKitAliasPresentCount: number;
  rootAgentKitAliasMessageIdMatchCount: number;
  exactRootMatchCount: number;
  strictPrefixRootMatchCount: number;
  sameRunRootCount: number;
  messageCreatedEventCount: number;
  messageCompletedEventCount: number;
  completionProven: boolean;
  messageStatus: Status;
  metadataStatus: Status;
  activeMessageCompared: boolean;
  activeMessageMatchesPersistedRun: boolean;
}

export interface PersistedAssistantProvenance {
  kind: "ok" | "unreadable";
  scanComplete: boolean;
  reason: Reason;
  rootMessages: ProvenanceMessageScan;
  snapshotMessages: ProvenanceMessageScan;
  events: ProvenanceScan;
  runs: ProvenanceScan;
  rootAssistantCount: number;
  rootAssistantsTruncated: boolean;
  snapshotAssistantCount: number;
  snapshotAssistants: SnapshotAssistantProvenance[];
}

interface ScanArray {
  values: readonly unknown[];
  summary: ProvenanceScan;
}
interface TextEvidence {
  text: string;
  present: boolean;
  length: number;
  truncated: boolean;
  unreadable: boolean;
  partsTotal: number;
  partsScanned: number;
  partsTruncated: boolean;
  partsUnreadable: boolean;
}
interface Assistant {
  message: Record<string, unknown>;
  id: string | null;
  runId: string | null;
  runIdPresent: boolean;
  runIdAmbiguous: boolean;
  text: TextEvidence;
}
interface EventEvidence {
  created: number;
  completed: number;
  runIds: Set<string>;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const stringId = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

function blankScan(state: State): ProvenanceScan {
  return {
    state,
    total: 0,
    scanned: 0,
    truncated: false,
    unreadable: state === "unreadable",
    unreadableCount: 0,
    ambiguousIdCount: 0,
  };
}

function messageScan(state: State): ProvenanceMessageScan {
  return {
    ...blankScan(state),
    assistantsScanned: 0,
    assistantsTruncated: false,
  };
}

function unreadableResult(reason: Reason): PersistedAssistantProvenance {
  return {
    kind: "unreadable",
    scanComplete: false,
    reason,
    rootMessages: messageScan("unreadable"),
    snapshotMessages: messageScan("unreadable"),
    events: blankScan("unreadable"),
    runs: blankScan("unreadable"),
    rootAssistantCount: 0,
    rootAssistantsTruncated: false,
    snapshotAssistantCount: 0,
    snapshotAssistants: [],
  };
}

function readData(body: unknown): {
  data: Record<string, unknown> | null;
  reason: Reason;
} {
  const wrapper = record(body);
  if (!wrapper) return { data: null, reason: "response-shape" };
  let data: unknown = wrapper.threadData;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return { data: null, reason: "invalid-json" };
    }
  }
  const parsed = record(data);
  return parsed
    ? { data: parsed, reason: "none" }
    : { data: null, reason: "messages-shape" };
}

function scanArray(
  parent: Record<string, unknown> | null,
  parentState: State,
  key: string,
  limit: number,
): ScanArray {
  if (parentState !== "present" || !parent)
    return { values: [], summary: blankScan(parentState) };
  if (!Object.prototype.hasOwnProperty.call(parent, key))
    return { values: [], summary: blankScan("absent") };
  const value = parent[key];
  if (!Array.isArray(value))
    return { values: [], summary: blankScan("unreadable") };
  const scanned = Math.min(value.length, limit);
  return {
    values: value.slice(0, scanned),
    summary: {
      state: "present",
      total: value.length,
      scanned,
      truncated: value.length > scanned,
      unreadable: false,
      unreadableCount: 0,
      ambiguousIdCount: 0,
    },
  };
}

function messageRecord(value: unknown): Record<string, unknown> | null {
  const outer = record(value);
  if (!outer) return null;
  const message = Object.prototype.hasOwnProperty.call(outer, "message")
    ? record(outer.message)
    : outer;
  return message && typeof message.role === "string" ? message : null;
}

function textEvidence(message: Record<string, unknown>): TextEvidence {
  const value = message.content ?? message.parts;
  if (typeof value === "string") {
    const text = value.slice(0, LIMIT.text);
    return {
      text,
      present: true,
      length: text.length,
      truncated: value.length > text.length,
      unreadable: false,
      partsTotal: 0,
      partsScanned: 0,
      partsTruncated: false,
      partsUnreadable: false,
    };
  }
  if (!Array.isArray(value)) {
    const absent = value === undefined || value === null;
    return {
      text: "",
      present: false,
      length: 0,
      truncated: false,
      unreadable: !absent,
      partsTotal: 0,
      partsScanned: 0,
      partsTruncated: false,
      partsUnreadable: !absent,
    };
  }
  const partsScanned = Math.min(value.length, LIMIT.parts);
  const partsTruncated = value.length > partsScanned;
  let text = "";
  let unreadable = false;
  let truncated = partsTruncated;
  for (const valuePart of value.slice(0, partsScanned)) {
    const part = record(valuePart);
    if (!part) {
      unreadable = true;
      continue;
    }
    if (part.type !== "text") continue;
    if (typeof part.text !== "string") {
      unreadable = true;
      continue;
    }
    const remaining = LIMIT.text - text.length;
    text += part.text.slice(0, remaining);
    if (part.text.length > remaining) truncated = true;
  }
  return {
    text,
    present: true,
    length: text.length,
    truncated,
    unreadable,
    partsTotal: value.length,
    partsScanned,
    partsTruncated,
    partsUnreadable: unreadable,
  };
}

function explicitRunIds(message: Record<string, unknown>): Set<string> {
  const metadata = record(message.metadata);
  const custom = record(metadata?.custom);
  const values = [
    metadata?.runId,
    custom?.runId,
    record(custom?.runError)?.runId,
    record(metadata?.runError)?.runId,
  ];
  return new Set(
    values.flatMap((value) => {
      const id = stringId(value);
      return id ? [id] : [];
    }),
  );
}

function idCounts(
  messages: readonly Record<string, unknown>[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const id = stringId(message.id);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function indexEvents(values: readonly unknown[]): {
  byId: Map<string, EventEvidence>;
  references: Map<
    string,
    { count: number; otherRunCounts: Map<string, number> }
  >;
  ambiguous: Set<string>;
  unreadableCount: number;
} {
  const byId = new Map<string, EventEvidence>();
  const references = new Map<
    string,
    { count: number; otherRunCounts: Map<string, number> }
  >();
  const ambiguous = new Set<string>();
  let unreadableCount = 0;
  for (const value of values) {
    const event = record(value);
    if (!event || typeof event.type !== "string" || !event.type.trim()) {
      unreadableCount++;
      continue;
    }
    const referenceIds = new Set([
      stringId(event.messageId),
      stringId(record(event.message)?.id),
      stringId(record(event.toolCall)?.messageId),
      stringId(record(event.invocation)?.messageId),
    ]);
    for (const referenceId of referenceIds) {
      if (!referenceId) continue;
      const reference = references.get(referenceId) ?? {
        count: 0,
        otherRunCounts: new Map<string, number>(),
      };
      reference.count++;
      const runId = stringId(event.runId);
      if (
        runId &&
        event.type !== "message.created" &&
        event.type !== "message.completed"
      )
        reference.otherRunCounts.set(
          runId,
          (reference.otherRunCounts.get(runId) ?? 0) + 1,
        );
      references.set(referenceId, reference);
    }
    if (event.type !== "message.created" && event.type !== "message.completed")
      continue;
    const message = record(event.message);
    if (!message || typeof message.role !== "string") {
      unreadableCount++;
      continue;
    }
    if (message.role !== "assistant") continue;
    const embeddedId = stringId(message.id);
    const eventId = stringId(event.messageId);
    if (embeddedId && eventId && embeddedId !== eventId) {
      ambiguous.add(embeddedId);
      ambiguous.add(eventId);
      continue;
    }
    const id = embeddedId ?? eventId;
    if (!id) {
      unreadableCount++;
      continue;
    }
    const evidence = byId.get(id) ?? {
      created: 0,
      completed: 0,
      runIds: new Set<string>(),
    };
    if (event.type === "message.created") evidence.created++;
    else evidence.completed++;
    const runId = stringId(event.runId);
    if (runId) evidence.runIds.add(runId);
    byId.set(id, evidence);
  }
  return { byId, references, ambiguous, unreadableCount };
}

function indexRuns(values: readonly unknown[]): {
  byActiveId: Map<string, Set<string>>;
  activeByRunId: Map<string, Set<string>>;
  unreadableCount: number;
} {
  const byActiveId = new Map<string, Set<string>>();
  const activeByRunId = new Map<string, Set<string>>();
  let unreadableCount = 0;
  for (const value of values) {
    const run = record(value);
    const runId = stringId(run?.id);
    if (!run || !runId) {
      unreadableCount++;
      continue;
    }
    const activeId = stringId(run.activeMessageId);
    if (!activeId) continue;
    const runs = byActiveId.get(activeId) ?? new Set<string>();
    runs.add(runId);
    byActiveId.set(activeId, runs);
    const activeIds = activeByRunId.get(runId) ?? new Set<string>();
    activeIds.add(activeId);
    activeByRunId.set(runId, activeIds);
  }
  return { byActiveId, activeByRunId, unreadableCount };
}

function collectAssistants(
  values: readonly unknown[],
  summary: ProvenanceMessageScan,
): Record<string, unknown>[] {
  const assistants: Record<string, unknown>[] = [];
  for (const value of values) {
    const message = messageRecord(value);
    if (!message) summary.unreadableCount++;
    else if (message.role === "assistant") assistants.push(message);
  }
  summary.assistantsScanned = assistants.length;
  summary.assistantsTruncated =
    summary.truncated || summary.unreadableCount > 0;
  summary.unreadable =
    summary.state === "unreadable" || summary.unreadableCount > 0;
  return assistants;
}

function withRunEvidence(
  messages: readonly Record<string, unknown>[],
  ownIds: Map<string, number>,
  otherIds: Map<string, number>,
  events: ReturnType<typeof indexEvents>,
  runs: ReturnType<typeof indexRuns>,
  eventScan: ProvenanceScan,
  runScan: ProvenanceScan,
): Assistant[] {
  return messages.map((message) => {
    const id = stringId(message.id);
    const explicit = explicitRunIds(message);
    const event = id ? events.byId.get(id) : undefined;
    const runIds = id ? runs.byActiveId.get(id) : undefined;
    const candidates = new Set([
      ...explicit,
      ...(event?.runIds ?? []),
      ...(runIds ?? []),
    ]);
    const duplicateId = Boolean(
      id && ((ownIds.get(id) ?? 0) > 1 || (otherIds.get(id) ?? 0) > 1),
    );
    const incomplete = Boolean(
      id &&
      (eventScan.state === "unreadable" ||
        eventScan.truncated ||
        eventScan.unreadable ||
        runScan.state === "unreadable" ||
        runScan.truncated ||
        runScan.unreadable),
    );
    const ambiguous =
      candidates.size > 1 ||
      Boolean(id && (duplicateId || events.ambiguous.has(id) || incomplete));
    return {
      message,
      id,
      runId: ambiguous ? null : (candidates.values().next().value ?? null),
      runIdPresent: candidates.size > 0,
      runIdAmbiguous: ambiguous,
      text: textEvidence(message),
    };
  });
}

function allowedStatus(value: unknown): Status {
  const status = typeof value === "string" ? value : record(value)?.type;
  return typeof status === "string" && STATUS.has(status)
    ? (status as Status)
    : "unknown";
}

function safeStatus(message: Record<string, unknown>): Status {
  return allowedStatus(record(message.metadata)?.status);
}

function submittedUserRuns(
  rootValues: readonly unknown[],
  snapshotValues: readonly unknown[],
): (string | null)[] {
  const byUserId = new Map<string, string | null>();
  for (const value of rootValues) {
    const root = messageRecord(value);
    if (root?.role !== "user") continue;
    const custom = record(record(root.metadata)?.custom);
    const id =
      typeof custom?.agentKitMessageId === "string"
        ? custom.agentKitMessageId
        : typeof root.id === "string"
          ? root.id
          : undefined;
    const runId = custom?.submittedRunId;
    if (!id || typeof runId !== "string") continue;
    byUserId.set(id, byUserId.has(id) ? null : runId);
  }
  const userCounts = new Map<string, number>();
  for (const value of snapshotValues) {
    const candidate = messageRecord(value);
    if (candidate?.role === "user" && typeof candidate.id === "string")
      userCounts.set(candidate.id, (userCounts.get(candidate.id) ?? 0) + 1);
  }
  let precedingRunId: string | null = null;
  const inferred: (string | null)[] = [];
  for (const value of snapshotValues) {
    const candidate = messageRecord(value);
    if (candidate?.role === "user") {
      const id = typeof candidate.id === "string" ? candidate.id : null;
      precedingRunId =
        id && userCounts.get(id) === 1 ? (byUserId.get(id) ?? null) : null;
    } else if (candidate?.role === "assistant") {
      inferred.push(precedingRunId);
    }
  }
  return inferred;
}

function snapshotResult(
  snapshot: Assistant,
  ordinal: number,
  roots: readonly Assistant[],
  snapshotIds: Map<string, number>,
  rootIds: Map<string, number>,
  events: ReturnType<typeof indexEvents>,
  eventScan: ProvenanceScan,
  runs: ReturnType<typeof indexRuns>,
  runScan: ProvenanceScan,
  messageScansComplete: boolean,
  submittedUserRunId: string | null,
): SnapshotAssistantProvenance {
  const id = snapshot.id;
  const event = id ? events.byId.get(id) : undefined;
  const messageIdAmbiguous = Boolean(
    id &&
    ((snapshotIds.get(id) ?? 0) > 1 ||
      (rootIds.get(id) ?? 0) > 1 ||
      events.ambiguous.has(id)),
  );
  const activeIds = snapshot.runId
    ? runs.activeByRunId.get(snapshot.runId)
    : undefined;
  const activeMessageCompared = Boolean(
    id &&
    snapshot.runId &&
    activeIds?.size === 1 &&
    runScan.state === "present" &&
    !runScan.truncated &&
    !runScan.unreadable,
  );
  let exactRootMatchCount = 0;
  let strictPrefixRootMatchCount = 0;
  let sameRunRootCount = 0;
  let nativeServerRunRootMessageIdMatchCount = 0;
  let otherEventSameRunRootMatchCount = 0;
  const countedRootRunIds = new Set<string>();
  let rootAgentKitAliasPresentCount = 0;
  let rootAgentKitAliasMessageIdMatchCount = 0;
  const reference = id ? events.references.get(id) : undefined;
  for (const root of roots) {
    const metadata = record(root.message.metadata);
    const explicitRootRunId = stringId(metadata?.runId);
    if (
      id &&
      explicitRootRunId &&
      !root.runIdAmbiguous &&
      root.runId === explicitRootRunId &&
      id === `server-${explicitRootRunId}`
    )
      nativeServerRunRootMessageIdMatchCount++;
    if (
      root.runId &&
      !root.runIdAmbiguous &&
      !countedRootRunIds.has(root.runId)
    ) {
      countedRootRunIds.add(root.runId);
      otherEventSameRunRootMatchCount +=
        reference?.otherRunCounts.get(root.runId) ?? 0;
    }
    const alias = stringId(record(metadata?.custom)?.agentKitMessageId);
    if (alias) {
      rootAgentKitAliasPresentCount++;
      if (id && alias === id) rootAgentKitAliasMessageIdMatchCount++;
    }
    if (snapshot.runId && root.runId && snapshot.runId === root.runId)
      sameRunRootCount++;
    const a = snapshot.text;
    const b = root.text;
    if (
      !a.present ||
      !b.present ||
      a.unreadable ||
      b.unreadable ||
      a.truncated ||
      b.truncated ||
      !a.length ||
      !b.length
    )
      continue;
    if (a.text === b.text) exactRootMatchCount++;
    else if (a.length < b.length && b.text.startsWith(a.text))
      strictPrefixRootMatchCount++;
  }
  const completedCount = event?.completed ?? 0;
  const eventsComplete =
    eventScan.state === "present" &&
    !eventScan.truncated &&
    !eventScan.unreadable;
  return {
    ordinal,
    messageIdPresent: id !== null,
    messageIdAmbiguous,
    runIdPresent: snapshot.runIdPresent,
    runIdAmbiguous: snapshot.runIdAmbiguous,
    textPresent: snapshot.text.present,
    textLength: snapshot.text.length,
    textTruncated: snapshot.text.truncated,
    textUnreadable: snapshot.text.unreadable,
    partsTotal: snapshot.text.partsTotal,
    partsScanned: snapshot.text.partsScanned,
    partsTruncated: snapshot.text.partsTruncated,
    partsUnreadable: snapshot.text.partsUnreadable,
    rootMessageIdMatchCount: id ? (rootIds.get(id) ?? 0) : 0,
    submittedUserInferredRootRunMatchCount:
      id &&
      messageScansComplete &&
      !snapshot.runIdPresent &&
      !snapshot.runIdAmbiguous &&
      submittedUserRunId
        ? roots.filter(
            (root) => !root.runIdAmbiguous && root.runId === submittedUserRunId,
          ).length
        : 0,
    nativeServerRunRootMessageIdMatchCount,
    anyEventReferenceCount: reference?.count ?? 0,
    otherEventSameRunRootMatchCount,
    rootAgentKitAliasPresentCount,
    rootAgentKitAliasMessageIdMatchCount,
    exactRootMatchCount,
    strictPrefixRootMatchCount,
    sameRunRootCount,
    messageCreatedEventCount: event?.created ?? 0,
    messageCompletedEventCount: completedCount,
    completionProven: Boolean(
      completedCount &&
      id &&
      !messageIdAmbiguous &&
      !snapshot.runIdAmbiguous &&
      messageScansComplete &&
      eventsComplete &&
      (runs.byActiveId.get(id)?.size ?? 0) <= 1,
    ),
    messageStatus: allowedStatus(snapshot.message.status),
    metadataStatus: safeStatus(snapshot.message),
    activeMessageCompared,
    activeMessageMatchesPersistedRun: Boolean(
      activeMessageCompared && id && activeIds?.has(id),
    ),
  };
}

export function inspectPersistedAssistantProvenance(
  body: unknown,
): PersistedAssistantProvenance {
  try {
    const parsed = readData(body);
    if (!parsed.data) return unreadableResult(parsed.reason);
    const data = parsed.data;
    const kit = record(data.agentKit);
    const kitState: State = !Object.prototype.hasOwnProperty.call(
      data,
      "agentKit",
    )
      ? "absent"
      : kit
        ? "present"
        : "unreadable";
    const rootArray = scanArray(data, "present", "messages", LIMIT.roots);
    const snapshotArray = scanArray(kit, kitState, "messages", LIMIT.snapshots);
    const eventArray = scanArray(kit, kitState, "events", LIMIT.events);
    const runArray = scanArray(kit, kitState, "runs", LIMIT.runs);
    const events = indexEvents(eventArray.values);
    const runs = indexRuns(runArray.values);
    Object.assign(eventArray.summary, {
      unreadableCount: events.unreadableCount,
      unreadable:
        eventArray.summary.state === "unreadable" || events.unreadableCount > 0,
      ambiguousIdCount: events.ambiguous.size,
    });
    Object.assign(runArray.summary, {
      unreadableCount: runs.unreadableCount,
      unreadable:
        runArray.summary.state === "unreadable" || runs.unreadableCount > 0,
    });
    const rootSummary = Object.assign(
      messageScan(rootArray.summary.state),
      rootArray.summary,
    );
    const snapshotSummary = Object.assign(
      messageScan(snapshotArray.summary.state),
      snapshotArray.summary,
    );
    const rootRaw = collectAssistants(rootArray.values, rootSummary);
    const snapshotRaw = collectAssistants(
      snapshotArray.values,
      snapshotSummary,
    );
    const rootIds = idCounts(rootRaw);
    const snapshotIds = idCounts(snapshotRaw);
    const roots = withRunEvidence(
      rootRaw,
      rootIds,
      snapshotIds,
      events,
      runs,
      eventArray.summary,
      runArray.summary,
    );
    const snapshots = withRunEvidence(
      snapshotRaw,
      snapshotIds,
      rootIds,
      events,
      runs,
      eventArray.summary,
      runArray.summary,
    );
    rootSummary.ambiguousIdCount = [...rootIds.values()].filter(
      (count) => count > 1,
    ).length;
    snapshotSummary.ambiguousIdCount = new Set([
      ...[...snapshotIds].filter(([, count]) => count > 1).map(([id]) => id),
      ...[...rootIds]
        .filter(([id, count]) => count > 1 && snapshotIds.has(id))
        .map(([id]) => id),
      ...[...events.ambiguous].filter((id) => snapshotIds.has(id)),
    ]).size;
    const readable =
      (rootArray.summary.state === "present" ||
        snapshotArray.summary.state === "present") &&
      ![
        rootSummary,
        snapshotSummary,
        eventArray.summary,
        runArray.summary,
      ].some((scan) => scan.state === "unreadable" || scan.unreadable);
    const messageScansComplete =
      rootSummary.state !== "unreadable" &&
      snapshotSummary.state !== "unreadable" &&
      !rootSummary.truncated &&
      !snapshotSummary.truncated &&
      !rootSummary.unreadable &&
      !snapshotSummary.unreadable;
    const submittedRuns = submittedUserRuns(
      rootArray.values,
      snapshotArray.values,
    );
    return {
      kind: readable ? "ok" : "unreadable",
      scanComplete:
        readable &&
        [
          rootSummary,
          snapshotSummary,
          eventArray.summary,
          runArray.summary,
        ].every(
          (scan) =>
            !scan.truncated && !scan.unreadable && scan.state !== "unreadable",
        ) &&
        [...roots, ...snapshots].every(
          ({ text }) =>
            !text.unreadable &&
            !text.truncated &&
            !text.partsUnreadable &&
            !text.partsTruncated,
        ),
      reason: readable ? "none" : "messages-shape",
      rootMessages: rootSummary,
      snapshotMessages: snapshotSummary,
      events: eventArray.summary,
      runs: runArray.summary,
      rootAssistantCount: roots.length,
      rootAssistantsTruncated: rootSummary.assistantsTruncated,
      snapshotAssistantCount: snapshots.length,
      snapshotAssistants: snapshots.map((snapshot, index) =>
        snapshotResult(
          snapshot,
          index + 1,
          roots,
          snapshotIds,
          rootIds,
          events,
          eventArray.summary,
          runs,
          runArray.summary,
          messageScansComplete,
          submittedRuns[index] ?? null,
        ),
      ),
    };
  } catch {
    return unreadableResult("unknown");
  }
}
