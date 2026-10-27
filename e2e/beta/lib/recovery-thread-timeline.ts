const LIMIT = {
  captures: 8,
  pending: 2,
  messages: 64,
  runs: 32,
  text: 8_192,
  id: 256,
} as const;
export const RECOVERY_TIMELINE_BODY_LIMIT = 4 * 1024 * 1024;
export type RecoveryTimelinePhase =
  | "before-first-reload"
  | "after-first-reload"
  | "after-second-reload";
type CaptureState = "ok" | "unreadable" | "oversized";
type Message = {
  id: string | null;
  runId: string | null;
  text: string;
  streaming: boolean;
};
type Run = { id: string | null; activeId: string | null; running: boolean };
type Capture = {
  ordinal: number;
  phase: RecoveryTimelinePhase;
  state: CaptureState;
  truncated: boolean;
  rootsMissing: boolean;
  snapshotsMissing: boolean;
  runsMissing: boolean;
  ambiguousIdCount: number;
  roots: Message[];
  snapshots: Message[];
  runs: Run[];
};
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function matchesRecoveryThreadResponse(
  origin: string,
  url: string,
  method: string,
  currentThreadId: string | null,
): boolean {
  if (method !== "GET" || !currentThreadId || currentThreadId.length > LIMIT.id)
    return false;
  if (!URL.canParse(url)) return false;
  const target = new URL(url);
  return (
    target.origin === origin &&
    !target.username &&
    !target.password &&
    target.pathname ===
      `/_agent-native/agent-chat/threads/${encodeURIComponent(currentThreadId)}`
  );
}

function parseCapture(
  ordinal: number,
  phase: RecoveryTimelinePhase,
  body: string,
): Capture {
  const capture: Capture = {
    ordinal,
    phase,
    state: "ok",
    truncated: false,
    rootsMissing: true,
    snapshotsMissing: true,
    runsMissing: true,
    ambiguousIdCount: 0,
    roots: [],
    snapshots: [],
    runs: [],
  };
  const id = (value: unknown): string | null => {
    if (typeof value !== "string" || !value.trim()) return null;
    if (value.length > LIMIT.id) {
      capture.truncated = true;
      return null;
    }
    return value;
  };
  const array = (
    parent: Record<string, unknown> | null,
    key: string,
    limit: number,
  ): unknown[] => {
    if (!parent || !Object.hasOwn(parent, key)) return [];
    const value = parent[key];
    if (!Array.isArray(value)) {
      capture.state = "unreadable";
      return [];
    }
    if (value.length > limit) capture.truncated = true;
    return value.slice(0, limit);
  };
  const messages = (values: unknown[]): Message[] =>
    values.flatMap((value) => {
      const outer = record(value);
      const message =
        outer && Object.hasOwn(outer, "message")
          ? record(outer.message)
          : outer;
      if (!message || typeof message.role !== "string") {
        capture.state = "unreadable";
        return [];
      }
      if (message.role !== "assistant") return [];
      const content = message.content ?? message.parts;
      let text = "";
      if (typeof content === "string") {
        text = content.slice(0, LIMIT.text);
        if (content.length > LIMIT.text) capture.truncated = true;
      } else if (Array.isArray(content)) {
        if (content.length > LIMIT.messages) capture.truncated = true;
        for (const value of content.slice(0, LIMIT.messages)) {
          const part = record(value);
          if (!part) {
            capture.state = "unreadable";
            continue;
          }
          if (part.type !== "text") continue;
          if (typeof part.text !== "string") {
            capture.state = "unreadable";
            continue;
          }
          const remaining = LIMIT.text - text.length;
          text += part.text.slice(0, remaining);
          if (part.text.length > remaining) capture.truncated = true;
        }
      } else if (content !== undefined && content !== null)
        capture.state = "unreadable";
      const status =
        typeof message.status === "string"
          ? message.status
          : record(message.status)?.type;
      return [
        {
          id: id(message.id),
          runId: id(record(message.metadata)?.runId),
          text,
          streaming:
            status === "streaming" ||
            status === "running" ||
            status === "in_progress",
        },
      ];
    });
  try {
    if (Buffer.byteLength(body, "utf8") > RECOVERY_TIMELINE_BODY_LIMIT) {
      capture.state = "oversized";
      return capture;
    }
    const wrapper = record(JSON.parse(body));
    const data = record(
      typeof wrapper?.threadData === "string"
        ? JSON.parse(wrapper.threadData)
        : wrapper?.threadData,
    );
    if (!data) {
      capture.state = "unreadable";
      return capture;
    }
    const kit = record(data.agentKit);
    if (Object.hasOwn(data, "agentKit") && !kit) capture.state = "unreadable";
    capture.rootsMissing = !Object.hasOwn(data, "messages");
    capture.snapshotsMissing = !kit || !Object.hasOwn(kit, "messages");
    capture.runsMissing = !kit || !Object.hasOwn(kit, "runs");
    capture.roots = messages(array(data, "messages", LIMIT.messages));
    capture.snapshots = messages(array(kit, "messages", LIMIT.messages));
    capture.runs = array(kit, "runs", LIMIT.runs).flatMap((value) => {
      const run = record(value);
      if (
        !run ||
        typeof run.status !== "string" ||
        ![
          "queued",
          "running",
          "in_progress",
          "awaiting_approval",
          "awaiting_input",
          "completed",
          "failed",
          "cancelled",
        ].includes(run.status) ||
        !id(run.id)
      ) {
        capture.state = "unreadable";
        return [];
      }
      return [
        {
          id: id(run.id),
          activeId: id(run.activeMessageId),
          running: [
            "queued",
            "running",
            "in_progress",
            "awaiting_approval",
            "awaiting_input",
          ].includes(run.status),
        },
      ];
    });
    for (const values of [
      capture.roots,
      capture.snapshots,
      capture.runs,
      capture.runs.map((run) => ({ id: run.activeId })),
    ]) {
      const counts = new Map<string, number>();
      for (const value of values)
        if (value.id) counts.set(value.id, (counts.get(value.id) ?? 0) + 1);
      capture.ambiguousIdCount += [...counts.values()].filter(
        (count) => count > 1,
      ).length;
    }
    return capture;
  } catch {
    capture.state = "unreadable";
    return capture;
  }
}

export class RecoveryThreadTimeline {
  private captures = new Map<number, Capture>();
  private pending = new Map<number, RecoveryTimelinePhase>();
  private nextOrdinal = 0;
  private omittedCount = 0;
  private phaseCounts = new Map<RecoveryTimelinePhase, number>();

  begin(phase: RecoveryTimelinePhase): number | null {
    const phaseLimit = phase === "before-first-reload" ? 2 : 3;
    if (
      this.nextOrdinal >= LIMIT.captures ||
      this.pending.size >= LIMIT.pending ||
      (this.phaseCounts.get(phase) ?? 0) >= phaseLimit
    ) {
      this.omittedCount++;
      return null;
    }
    const ordinal = ++this.nextOrdinal;
    this.pending.set(ordinal, phase);
    this.phaseCounts.set(phase, (this.phaseCounts.get(phase) ?? 0) + 1);
    return ordinal;
  }

  accept(ordinal: number, body: string): void {
    const phase = this.pending.get(ordinal);
    if (!phase) return;
    this.pending.delete(ordinal);
    this.captures.set(ordinal, parseCapture(ordinal, phase, body));
  }

  reject(ordinal: number, state: "unreadable" | "oversized"): void {
    const phase = this.pending.get(ordinal);
    if (!phase) return;
    this.pending.delete(ordinal);
    const capture = parseCapture(ordinal, phase, "null");
    capture.state = state;
    this.captures.set(ordinal, capture);
  }

  summary(cleanupFailed = false) {
    const captures = [...this.captures.values()].sort(
      (a, b) => a.ordinal - b.ordinal,
    );
    const final = captures
      .filter((capture) => capture.phase === "after-second-reload")
      .at(-1);
    const readable = (capture: Capture) =>
      capture.state === "ok" &&
      !capture.truncated &&
      capture.ambiguousIdCount === 0;
    const prior = captures.filter(
      (capture) =>
        final &&
        capture.ordinal < final.ordinal &&
        capture.phase !== "after-second-reload" &&
        readable(capture),
    );
    const finalPrefixes =
      final && readable(final)
        ? final.snapshots.flatMap((snapshot, index) => {
            const strictRootPrefixCount = final.roots.filter(
              (root) =>
                snapshot.text.length > 0 &&
                snapshot.text.length < root.text.length &&
                root.text.startsWith(snapshot.text),
            ).length;
            if (!strictRootPrefixCount) return [];
            const earlierRoots = prior.flatMap((capture) =>
              capture.roots.filter(
                (root) =>
                  root.streaming ||
                  Boolean(
                    root.runId &&
                    capture.runs.some(
                      (run) => run.running && run.id === root.runId,
                    ),
                  ),
              ),
            );
            const matchingRoots = snapshot.id
              ? earlierRoots.filter((root) => root.id === snapshot.id)
              : [];
            return [
              {
                ordinal: index + 1,
                strictRootPrefixCount,
                messageIdPresent: snapshot.id !== null,
                priorRunningRootIdMatchCount: matchingRoots.length,
                priorRunningRootTextEqualsCount: matchingRoots.filter(
                  (root) => root.text === snapshot.text,
                ).length,
                priorActiveDraftIdMatchCount: snapshot.id
                  ? prior
                      .flatMap((capture) => capture.runs)
                      .filter(
                        (run) => run.running && run.activeId === snapshot.id,
                      ).length
                  : 0,
              },
            ];
          })
        : [];
    return {
      kind:
        captures.length === 0
          ? "missing"
          : cleanupFailed ||
              this.pending.size ||
              this.omittedCount ||
              !final ||
              prior.length === 0 ||
              captures.some(
                (capture) =>
                  !readable(capture) ||
                  capture.rootsMissing ||
                  capture.snapshotsMissing ||
                  capture.runsMissing,
              )
            ? "partial"
            : "complete",
      captureCount: captures.length,
      pendingCount: this.pending.size,
      omittedCount: this.omittedCount,
      cleanupFailed,
      finalCapturePresent: Boolean(final),
      priorReadableCaptureCount: prior.length,
      priorRunningCaptureCount: prior.filter(
        (capture) =>
          capture.runs.some((run) => run.running) ||
          capture.roots.some((root) => root.streaming),
      ).length,
      captures: captures.map((capture) => ({
        ordinal: capture.ordinal,
        phase: capture.phase,
        state: capture.state,
        truncated: capture.truncated,
        rootsMissing: capture.rootsMissing,
        snapshotsMissing: capture.snapshotsMissing,
        runsMissing: capture.runsMissing,
        ambiguousIdCount: capture.ambiguousIdCount,
        rootAssistantCount: capture.roots.length,
        snapshotAssistantCount: capture.snapshots.length,
        rootMessageIdMissingCount: capture.roots.filter((root) => !root.id)
          .length,
        snapshotMessageIdMissingCount: capture.snapshots.filter(
          (snapshot) => !snapshot.id,
        ).length,
        runningActiveMessageIdMissingCount: capture.runs.filter(
          (run) => run.running && !run.activeId,
        ).length,
        runningRunCount: capture.runs.filter((run) => run.running).length,
      })),
      finalPrefixes,
    };
  }
}
