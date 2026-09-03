import type {
  AgentCapabilities,
  AgentEvent,
  AgentMessage,
  AgentRunSnapshot,
  AgentThreadSnapshot,
  AgentTransport,
  StartRunResult,
} from "@agent-native/agentkit-protocol";
import {
  AGENTKIT_PROTOCOL_VERSION,
  parseAgentCapabilities,
  parseAgentEvent,
  parseAgentEventSequence,
  parseAgentQueuedMessage,
  parseAgentThreadSnapshot,
} from "@agent-native/agentkit-protocol";

export class AgentKitConformanceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AgentKitConformanceError";
  }
}

export type AgentKitConformanceScenario =
  | "completed"
  | "cancellation"
  | "abort"
  | "reconnect"
  | "cross-thread"
  | "approval"
  | "queue"
  | "terminal-failure";

export type AgentKitConformanceTransportFactory = (
  scenario: AgentKitConformanceScenario,
) => AgentTransport | Promise<AgentTransport>;

interface AgentKitConformanceSharedOptions {
  threadId?: string;
  messages?: AgentMessage[];
  timeoutMs?: number;
  isUnsupportedError?: (error: unknown) => boolean;
}

export type AgentKitConformanceOptions = AgentKitConformanceSharedOptions &
  (
    | {
        /** Runs the baseline contract against an already-created transport. */
        transport: AgentTransport;
        createTransport?: never;
      }
    | {
        /**
         * Creates isolated transports for deterministic lifecycle scenarios.
         * Use this full profile for adapters and remote transport releases.
         */
        createTransport: AgentKitConformanceTransportFactory;
        transport?: never;
      }
  );

export interface AgentKitConformanceReport {
  profile: "baseline" | "full";
  runId: string;
  eventCount: number;
  replayedEventCount: number;
  scenarioEventCount: number;
  capabilities: AgentCapabilities;
  checks: readonly string[];
}

type AgentTerminalEvent = Extract<
  AgentEvent,
  { type: "run.completed" | "run.failed" | "run.cancelled" }
>;

const DEFAULT_TIMEOUT_MS = 2_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AgentKitConformanceError(message);
}

function unsupportedByDefault(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "unsupported_capability" ||
    (typeof candidate.message === "string" &&
      /(?:unsupported|not supported|capabilit)/iu.test(candidate.message))
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new AgentKitConformanceError(
                `${label} did not settle within ${timeoutMs}ms.`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function collectIterator(
  iterator: AsyncIterator<AgentEvent>,
  timeoutMs: number,
  label: string,
): Promise<AgentEvent[]> {
  return withTimeout(
    (async () => {
      const events: AgentEvent[] = [];
      while (true) {
        const next = await iterator.next();
        if (next.done) return events;
        events.push(parseAgentEvent(next.value));
      }
    })(),
    timeoutMs,
    label,
  );
}

async function collect(
  iterable: AsyncIterable<AgentEvent>,
  timeoutMs: number,
  label: string,
): Promise<AgentEvent[]> {
  return collectIterator(iterable[Symbol.asyncIterator](), timeoutMs, label);
}

function terminalStatus(event: AgentTerminalEvent): AgentRunSnapshot["status"] {
  if (event.type === "run.completed") return "completed";
  if (event.type === "run.failed") return "failed";
  return "cancelled";
}

function isTerminal(
  event: AgentEvent | undefined,
): event is AgentTerminalEvent {
  return (
    event?.type === "run.completed" ||
    event?.type === "run.failed" ||
    event?.type === "run.cancelled"
  );
}

function assertTerminalActivities(events: readonly AgentEvent[]): void {
  const activities = new Map<
    string,
    Extract<
      AgentEvent,
      {
        type: "activity.started" | "activity.updated" | "activity.completed";
      }
    >
  >();
  for (const event of events) {
    if (
      event.type === "activity.started" ||
      event.type === "activity.updated" ||
      event.type === "activity.completed"
    ) {
      activities.set(event.activity.id, event);
    }
  }
  const running = [...activities.values()].filter(
    (event) => event.activity.status === "running",
  );
  assert(
    running.length === 0,
    `A terminal run must close every running activity; still running: ${running.map((event) => event.activity.id).join(", ")}.`,
  );
}

type LifecycleEvent = Extract<
  AgentEvent,
  {
    type: `annotation.${string}` | `widget.${string}` | `task-group.${string}`;
  }
>;

interface LifecycleProjection {
  annotations: Map<string, { messageId?: string; value: unknown }>;
  widgets: Map<string, { messageId?: string; value: unknown }>;
  taskGroups: Map<string, unknown>;
}

function createLifecycleProjection(): LifecycleProjection {
  return {
    annotations: new Map(),
    widgets: new Map(),
    taskGroups: new Map(),
  };
}

function applyLifecycleEvent(
  projection: LifecycleProjection,
  event: LifecycleEvent,
): void {
  switch (event.type) {
    case "annotation.created":
    case "annotation.updated": {
      const previous = projection.annotations.get(event.annotation.id);
      projection.annotations.set(event.annotation.id, {
        value: event.annotation,
        ...((event.messageId ?? previous?.messageId)
          ? { messageId: event.messageId ?? previous?.messageId }
          : {}),
      });
      return;
    }
    case "annotation.removed":
      projection.annotations.delete(event.annotationId);
      return;
    case "widget.created":
    case "widget.updated": {
      const previous = projection.widgets.get(event.widget.id);
      projection.widgets.set(event.widget.id, {
        value: event.widget,
        ...((event.messageId ?? previous?.messageId)
          ? { messageId: event.messageId ?? previous?.messageId }
          : {}),
      });
      return;
    }
    case "widget.removed":
      projection.widgets.delete(event.widgetId);
      return;
    case "task-group.created":
    case "task-group.updated":
    case "task-group.completed":
      projection.taskGroups.set(event.taskGroup.id, event.taskGroup);
      return;
    case "task-group.removed":
      projection.taskGroups.delete(event.taskGroupId);
  }
}

function serializeLifecycleProjection(projection: LifecycleProjection): string {
  const entries = (map: Map<string, unknown>) =>
    [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({
    annotations: entries(projection.annotations),
    widgets: entries(projection.widgets),
    taskGroups: entries(projection.taskGroups),
  });
}

function assertLifecycleCompleteness(
  events: readonly AgentEvent[],
  snapshot?: AgentThreadSnapshot,
): string[] {
  const lifecycleEvents = events.filter((event): event is LifecycleEvent =>
    /^(?:annotation|widget|task-group)\./u.test(event.type),
  );
  if (lifecycleEvents.length === 0) return [];

  const projection = createLifecycleProjection();
  lifecycleEvents.forEach((event) => applyLifecycleEvent(projection, event));
  const once = serializeLifecycleProjection(projection);
  lifecycleEvents.forEach((event) => applyLifecycleEvent(projection, event));
  assert(
    serializeLifecycleProjection(projection) === once,
    "Rich lifecycle events must be replay-idempotent.",
  );

  if (!snapshot) return ["rich lifecycle replay"];
  const projected = createLifecycleProjection();
  for (const entry of snapshot.annotations ?? []) {
    projected.annotations.set(entry.annotation.id, {
      messageId: entry.messageId,
      value: entry.annotation,
    });
  }
  for (const entry of snapshot.widgets ?? []) {
    projected.widgets.set(entry.widget.id, {
      messageId: entry.messageId,
      value: entry.widget,
    });
  }
  for (const taskGroup of snapshot.taskGroups ?? []) {
    projected.taskGroups.set(taskGroup.id, taskGroup);
  }
  assert(
    serializeLifecycleProjection(projected) === once,
    "Thread snapshot lifecycle projections must match replayed canonical events.",
  );
  return ["rich lifecycle replay", "rich lifecycle snapshot"];
}

function assertOrderedEvents(input: {
  events: readonly AgentEvent[];
  threadId: string;
  runId: string;
  afterSequence?: number;
  requireStarted?: boolean;
  terminal?: AgentTerminalEvent["type"] | "any" | "none";
}): void {
  const {
    events,
    threadId,
    runId,
    afterSequence = 0,
    requireStarted = afterSequence === 0,
    terminal = "any",
  } = input;
  assert(events.length > 0, "A run stream must emit at least one event.");
  parseAgentEventSequence(events, {
    afterSequence,
    threadId,
    runId,
    path: "runEvents",
  });
  if (requireStarted) {
    assert(
      events[0]?.type === "run.started",
      "The first event must be run.started.",
    );
  }

  const ids = new Set<string>();
  events.forEach((event, index) => {
    const expectedSequence = afterSequence + index + 1;
    assert(
      event.sequence === expectedSequence,
      `Event sequences must be contiguous; expected ${expectedSequence}, received ${event.sequence}.`,
    );
    assert(event.threadId === threadId, "Every event must preserve threadId.");
    assert(
      event.runId === runId,
      "Every event must preserve the runId returned by startRun.",
    );
    assert(
      !ids.has(event.id),
      `Event id ${event.id} was emitted more than once.`,
    );
    ids.add(event.id);
    if (isTerminal(event)) {
      assert(
        index === events.length - 1,
        "No event may be emitted after a terminal event.",
      );
    }
  });

  const finalEvent = events.at(-1);
  if (terminal === "none") {
    assert(
      !isTerminal(finalEvent),
      "An interrupted stream must not invent a terminal event.",
    );
    return;
  }
  assert(
    isTerminal(finalEvent),
    "A closed run stream must end with an explicit terminal event.",
  );
  if (terminal !== "any") {
    assert(
      finalEvent.type === terminal,
      `Expected ${terminal}, received ${finalEvent.type}.`,
    );
  }
}

async function readCapabilities(
  transport: AgentTransport,
): Promise<AgentCapabilities> {
  const staticCapabilities = transport.capabilities
    ? parseAgentCapabilities(transport.capabilities)
    : undefined;
  const capabilities = transport.getCapabilities
    ? parseAgentCapabilities(await transport.getCapabilities())
    : (staticCapabilities ?? {});
  if (staticCapabilities && transport.getCapabilities) {
    assert(
      JSON.stringify(staticCapabilities) === JSON.stringify(capabilities),
      "Static and discovered capabilities must not contradict one another.",
    );
  }
  assert(
    capabilities.protocolVersion === undefined ||
      capabilities.protocolVersion === AGENTKIT_PROTOCOL_VERSION,
    `Transport protocolVersion must be ${AGENTKIT_PROTOCOL_VERSION}.`,
  );
  return capabilities;
}

function assertCapabilitiesTruthful(
  transport: AgentTransport,
  capabilities: AgentCapabilities,
): void {
  const requireOperation = (
    capability: boolean | undefined,
    operation: unknown,
    label: string,
  ) => {
    if (capability) {
      assert(
        typeof operation === "function",
        `${label} is advertised but its transport operation is missing.`,
      );
    }
  };

  requireOperation(capabilities.actions, transport.invokeAction, "actions");
  requireOperation(
    capabilities.approvals,
    transport.resolveApproval,
    "approvals",
  );
  requireOperation(capabilities.feedback, transport.submitFeedback, "feedback");
  requireOperation(
    capabilities.threadHistory,
    transport.getThreadSnapshot,
    "threadHistory",
  );
  requireOperation(
    capabilities.threadForking,
    transport.forkThread,
    "threadForking",
  );
  requireOperation(
    capabilities.resumableRuns,
    transport.getRun,
    "resumableRuns",
  );

  if (capabilities.messageQueue) {
    for (const [name, operation] of [
      ["listQueuedMessages", transport.listQueuedMessages],
      ["queueMessage", transport.queueMessage],
      ["steerQueuedMessage", transport.steerQueuedMessage],
      ["removeQueuedMessage", transport.removeQueuedMessage],
    ] as const) {
      assert(
        typeof operation === "function",
        `messageQueue is advertised but ${name} is missing.`,
      );
    }
  }

  if (capabilities.uploads) {
    for (const [name, operation] of [
      ["createUpload", transport.createUpload],
      ["completeUpload", transport.completeUpload],
      ["cancelUpload", transport.cancelUpload],
    ] as const) {
      assert(
        typeof operation === "function",
        `uploads is advertised but ${name} is missing.`,
      );
    }
  }
}

async function assertUnsupportedOperations(
  transport: AgentTransport,
  capabilities: AgentCapabilities,
  isUnsupportedError: (error: unknown) => boolean,
  threadId: string,
): Promise<void> {
  const probe = async (
    label: string,
    operation: (() => Promise<unknown>) | undefined,
  ) => {
    if (!operation) return;
    let failure: unknown;
    try {
      await operation();
    } catch (error) {
      failure = error;
    }
    assert(
      failure !== undefined,
      `${label} must reject when it is not advertised.`,
    );
    assert(
      isUnsupportedError(failure),
      `${label} must reject with a recognizable unsupported-capability error.`,
    );
  };

  if (!capabilities.actions) {
    await probe(
      "invokeAction",
      transport.invokeAction
        ? () =>
            transport.invokeAction!({
              invocation: {
                id: "conformance-action",
                action: "conformance.unsupported",
                threadId,
              },
            })
        : undefined,
    );
  }
  if (!capabilities.approvals) {
    await probe(
      "resolveApproval",
      transport.resolveApproval
        ? () =>
            transport.resolveApproval!({
              threadId,
              runId: "conformance-unsupported-run",
              approvalId: "conformance-unsupported-approval",
              optionId: "approve",
              response: { decision: "approve" },
            })
        : undefined,
    );
  }
  if (!capabilities.feedback) {
    await probe(
      "submitFeedback",
      transport.submitFeedback
        ? () =>
            transport.submitFeedback!({
              threadId,
              messageId: "conformance-unsupported-message",
              value: "dismissed",
            })
        : undefined,
    );
  }
  if (!capabilities.threadHistory) {
    await probe(
      "getThreadSnapshot",
      transport.getThreadSnapshot
        ? () => transport.getThreadSnapshot!({ threadId })
        : undefined,
    );
  }
  if (!capabilities.threadForking) {
    await probe(
      "forkThread",
      transport.forkThread
        ? () => transport.forkThread!({ threadId })
        : undefined,
    );
  }
  if (!capabilities.messageQueue) {
    await probe(
      "queueMessage",
      transport.queueMessage
        ? () => transport.queueMessage!({ threadId, text: "unsupported" })
        : undefined,
    );
  }
  if (!capabilities.uploads) {
    await probe(
      "createUpload",
      transport.createUpload
        ? () =>
            transport.createUpload!({
              threadId,
              descriptor: {
                name: "unsupported.txt",
                mediaType: "text/plain",
                size: 0,
              },
            })
        : undefined,
    );
  }
}

function conformanceMessages(
  scenario: AgentKitConformanceScenario,
  messages?: AgentMessage[],
): AgentMessage[] {
  if (scenario === "completed" && messages) return messages;
  return [
    {
      id: `agentkit-conformance-${scenario}-message`,
      role: "user",
      parts: [
        {
          type: "text",
          text: `Execute the deterministic AgentKit ${scenario} scenario.`,
        },
      ],
      metadata: { "x-agentkit-conformance-scenario": scenario },
    },
  ];
}

async function startScenarioRun(input: {
  transport: AgentTransport;
  scenario: AgentKitConformanceScenario;
  threadId: string;
  messages?: AgentMessage[];
}): Promise<StartRunResult> {
  const started = await input.transport.startRun({
    threadId: input.threadId,
    messages: conformanceMessages(input.scenario, input.messages),
    metadata: { "x-agentkit-conformance-scenario": input.scenario },
  });
  assert(started.runId.length > 0, "startRun must return a stable runId.");
  if (started.capabilities) parseAgentCapabilities(started.capabilities);
  return started;
}

async function assertRunSnapshot(
  transport: AgentTransport,
  threadId: string,
  runId: string,
  terminal: AgentTerminalEvent,
): Promise<void> {
  if (!transport.getRun) return;
  const snapshot = await transport.getRun({ threadId, runId });
  assert(snapshot !== null, "getRun must return a started run.");
  assert(
    snapshot.lastSequence === terminal.sequence,
    "getRun.lastSequence must match the durable event log.",
  );
  assert(
    snapshot.status === terminalStatus(terminal),
    "getRun.status must match the terminal event.",
  );
  if (terminal.type === "run.failed") {
    assert(
      snapshot.error !== undefined,
      "A failed run snapshot must preserve its error.",
    );
    assert(
      snapshot.error.code === terminal.error.code,
      "A failed run snapshot must preserve the terminal error code.",
    );
  }
}

async function assertBaseline(input: {
  transport: AgentTransport;
  capabilities: AgentCapabilities;
  threadId: string;
  messages?: AgentMessage[];
  timeoutMs: number;
}): Promise<{
  runId: string;
  events: AgentEvent[];
  replay: AgentEvent[];
  lifecycleChecks: string[];
}> {
  const started = await startScenarioRun({
    transport: input.transport,
    scenario: "completed",
    threadId: input.threadId,
    messages: input.messages,
  });
  const events = await collect(
    input.transport.subscribeToRun({
      threadId: input.threadId,
      runId: started.runId,
    }),
    input.timeoutMs,
    "completed run stream",
  );
  assertOrderedEvents({
    events,
    threadId: input.threadId,
    runId: started.runId,
    terminal: "run.completed",
  });
  assertTerminalActivities(events);
  const terminal = events.at(-1) as AgentTerminalEvent;

  let replay: AgentEvent[] = [];
  if (input.capabilities.resumableRuns) {
    const cursor = Math.max(0, Math.floor(events.length / 2));
    replay = await collect(
      input.transport.subscribeToRun({
        threadId: input.threadId,
        runId: started.runId,
        afterSequence: cursor,
      }),
      input.timeoutMs,
      "completed run replay",
    );
    assertOrderedEvents({
      events: replay,
      threadId: input.threadId,
      runId: started.runId,
      afterSequence: cursor,
      requireStarted: false,
      terminal: "run.completed",
    });
    assert(
      replay.length === events.length - cursor,
      "A resumable subscription must replay every event after its cursor.",
    );
    assert(
      replay.every((event, index) => event.id === events[cursor + index]?.id),
      "Replay must preserve event identity and order.",
    );
  }

  await assertRunSnapshot(
    input.transport,
    input.threadId,
    started.runId,
    terminal,
  );
  let snapshot: AgentThreadSnapshot | undefined;
  if (input.transport.getThreadSnapshot) {
    const result = await input.transport.getThreadSnapshot({
      threadId: input.threadId,
    });
    assert(result !== null, "getThreadSnapshot must return the active thread.");
    snapshot = parseAgentThreadSnapshot(result);
    assert(
      snapshot.id === input.threadId,
      "getThreadSnapshot must preserve the requested thread id.",
    );
  }

  return {
    runId: started.runId,
    events,
    replay,
    lifecycleChecks: assertLifecycleCompleteness(events, snapshot),
  };
}

function sameCapabilities(
  baseline: AgentCapabilities,
  scenario: AgentCapabilities,
  name: AgentKitConformanceScenario,
): void {
  assert(
    JSON.stringify(baseline) === JSON.stringify(scenario),
    `Capabilities changed while preparing the ${name} scenario.`,
  );
}

async function assertCancellation(input: {
  transport: AgentTransport;
  threadId: string;
  timeoutMs: number;
}): Promise<number> {
  const started = await startScenarioRun({
    ...input,
    scenario: "cancellation",
  });
  const iterator = input.transport
    .subscribeToRun({ threadId: input.threadId, runId: started.runId })
    [Symbol.asyncIterator]();
  const first = await withTimeout(
    iterator.next(),
    input.timeoutMs,
    "cancellation run start",
  );
  assert(!first.done, "A cancellable run must start before it is cancelled.");
  const startedEvent = parseAgentEvent(first.value);
  assertOrderedEvents({
    events: [startedEvent],
    threadId: input.threadId,
    runId: started.runId,
    terminal: "none",
  });
  await input.transport.cancelRun({
    threadId: input.threadId,
    runId: started.runId,
  });
  const events = [
    startedEvent,
    ...(await collectIterator(
      iterator,
      input.timeoutMs,
      "cancelled run terminal event",
    )),
  ];
  assertOrderedEvents({
    events,
    threadId: input.threadId,
    runId: started.runId,
    terminal: "run.cancelled",
  });
  await assertRunSnapshot(
    input.transport,
    input.threadId,
    started.runId,
    events.at(-1) as AgentTerminalEvent,
  );
  return events.length;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function assertAbortDisconnect(input: {
  transport: AgentTransport;
  capabilities: AgentCapabilities;
  threadId: string;
  timeoutMs: number;
}): Promise<number> {
  const started = await startScenarioRun({ ...input, scenario: "abort" });
  const controller = new AbortController();
  const iterator = input.transport
    .subscribeToRun({
      threadId: input.threadId,
      runId: started.runId,
      signal: controller.signal,
    })
    [Symbol.asyncIterator]();
  const first = await withTimeout(
    iterator.next(),
    input.timeoutMs,
    "abort scenario first event",
  );
  assert(
    !first.done,
    "An abort scenario must emit run.started before disconnect.",
  );
  const startedEvent = parseAgentEvent(first.value);
  controller.abort(new DOMException("Conformance disconnect", "AbortError"));

  let afterAbort: IteratorResult<AgentEvent> | undefined;
  try {
    afterAbort = await withTimeout(
      iterator.next(),
      input.timeoutMs,
      "aborted subscription",
    );
  } catch (error) {
    assert(
      isAbortError(error),
      "An aborted subscription may only close or reject with AbortError.",
    );
  } finally {
    await iterator.return?.();
  }
  if (afterAbort) {
    assert(
      afterAbort.done,
      "Aborting a subscriber must stop event delivery without cancelling the run.",
    );
  }

  if (!input.capabilities.resumableRuns) {
    if (input.transport.getRun) {
      const snapshot = await input.transport.getRun({
        threadId: input.threadId,
        runId: started.runId,
      });
      assert(
        snapshot?.status !== "cancelled",
        "Aborting a subscriber must not cancel the remote run.",
      );
    }
    return 1;
  }

  const remainder = await collect(
    input.transport.subscribeToRun({
      threadId: input.threadId,
      runId: started.runId,
      afterSequence: startedEvent.sequence,
    }),
    input.timeoutMs,
    "post-abort replay",
  );
  assertOrderedEvents({
    events: remainder,
    threadId: input.threadId,
    runId: started.runId,
    afterSequence: startedEvent.sequence,
    requireStarted: false,
    terminal: "run.completed",
  });
  return 1 + remainder.length;
}

async function assertReconnectInterruption(input: {
  transport: AgentTransport;
  threadId: string;
  timeoutMs: number;
}): Promise<number> {
  const started = await startScenarioRun({ ...input, scenario: "reconnect" });
  const interrupted: AgentEvent[] = [];
  let interruption: unknown;
  try {
    const iterator = input.transport
      .subscribeToRun({
        threadId: input.threadId,
        runId: started.runId,
      })
      [Symbol.asyncIterator]();
    await withTimeout(
      (async () => {
        while (true) {
          const next = await iterator.next();
          if (next.done) return;
          interrupted.push(parseAgentEvent(next.value));
        }
      })(),
      input.timeoutMs,
      "interrupted subscription",
    );
  } catch (error) {
    interruption = error;
  }
  assert(
    interruption !== undefined,
    "The reconnect fixture must interrupt its first stream.",
  );
  assertOrderedEvents({
    events: interrupted,
    threadId: input.threadId,
    runId: started.runId,
    terminal: "none",
  });
  const cursor = interrupted.at(-1)?.sequence ?? 0;
  const replay = await collect(
    input.transport.subscribeToRun({
      threadId: input.threadId,
      runId: started.runId,
      afterSequence: cursor,
    }),
    input.timeoutMs,
    "reconnect replay",
  );
  assertOrderedEvents({
    events: replay,
    threadId: input.threadId,
    runId: started.runId,
    afterSequence: cursor,
    requireStarted: false,
    terminal: "run.completed",
  });
  const combined = [...interrupted, ...replay];
  assertOrderedEvents({
    events: combined,
    threadId: input.threadId,
    runId: started.runId,
    terminal: "run.completed",
  });
  return combined.length;
}

async function assertCrossThreadIsolation(input: {
  transport: AgentTransport;
  threadId: string;
  timeoutMs: number;
}): Promise<number> {
  const threadA = `${input.threadId}-a`;
  const threadB = `${input.threadId}-b`;
  const [runA, runB] = await Promise.all([
    startScenarioRun({
      transport: input.transport,
      scenario: "cross-thread",
      threadId: threadA,
    }),
    startScenarioRun({
      transport: input.transport,
      scenario: "cross-thread",
      threadId: threadB,
    }),
  ]);
  assert(
    runA.runId !== runB.runId,
    "Concurrent threads must receive distinct run ids.",
  );
  const [eventsA, eventsB] = await Promise.all([
    collect(
      input.transport.subscribeToRun({ threadId: threadA, runId: runA.runId }),
      input.timeoutMs,
      "thread A stream",
    ),
    collect(
      input.transport.subscribeToRun({ threadId: threadB, runId: runB.runId }),
      input.timeoutMs,
      "thread B stream",
    ),
  ]);
  assertOrderedEvents({
    events: eventsA,
    threadId: threadA,
    runId: runA.runId,
    terminal: "run.completed",
  });
  assertOrderedEvents({
    events: eventsB,
    threadId: threadB,
    runId: runB.runId,
    terminal: "run.completed",
  });

  const controller = new AbortController();
  const leakProbe = (async () => {
    const leaked: AgentEvent[] = [];
    try {
      for await (const event of input.transport.subscribeToRun({
        threadId: threadB,
        runId: runA.runId,
        signal: controller.signal,
      })) {
        leaked.push(parseAgentEvent(event));
        break;
      }
    } catch (error) {
      if (
        !isAbortError(error) &&
        !/unknown|not found|thread/iu.test(String(error))
      ) {
        throw error;
      }
    }
    return leaked;
  })();
  const abortTimer = setTimeout(() => controller.abort(), 25);
  const leaked = await withTimeout(
    leakProbe,
    input.timeoutMs,
    "cross-thread subscription rejection",
  ).finally(() => clearTimeout(abortTimer));
  assert(
    leaked.length === 0,
    "A run must never emit events to a different thread.",
  );

  if (input.transport.getRun) {
    let wrongThreadSnapshot: AgentRunSnapshot | null | undefined;
    try {
      wrongThreadSnapshot = await input.transport.getRun({
        threadId: threadB,
        runId: runA.runId,
      });
    } catch {
      wrongThreadSnapshot = null;
    }
    assert(
      wrongThreadSnapshot === null,
      "getRun must not expose a run through a different thread id.",
    );
  }
  return eventsA.length + eventsB.length;
}

async function assertApprovalContinuation(input: {
  transport: AgentTransport;
  threadId: string;
  timeoutMs: number;
}): Promise<number> {
  assert(
    input.transport.resolveApproval,
    "approvals requires resolveApproval.",
  );
  const started = await startScenarioRun({ ...input, scenario: "approval" });
  const iterator = input.transport
    .subscribeToRun({ threadId: input.threadId, runId: started.runId })
    [Symbol.asyncIterator]();
  const events: AgentEvent[] = [];
  let requested:
    | Extract<AgentEvent, { type: "approval.requested" }>
    | undefined;
  while (!requested) {
    const next = await withTimeout(
      iterator.next(),
      input.timeoutMs,
      "approval request",
    );
    assert(
      !next.done,
      "Approval streams must not close before approval.requested.",
    );
    const event = parseAgentEvent(next.value);
    events.push(event);
    assert(
      !isTerminal(event),
      "Approval must be requested before a terminal event.",
    );
    if (event.type === "approval.requested") requested = event;
  }
  await input.transport.resolveApproval({
    threadId: input.threadId,
    runId: started.runId,
    approvalId: requested.request.id,
    optionId: "approve",
    response: { decision: "approve", optionIds: ["approve"] },
  });
  events.push(
    ...(await collectIterator(
      iterator,
      input.timeoutMs,
      "approval continuation",
    )),
  );
  assertOrderedEvents({
    events,
    threadId: input.threadId,
    runId: started.runId,
    terminal: "run.completed",
  });
  const resolvedIndex = events.findIndex(
    (event) =>
      event.type === "approval.resolved" &&
      event.approvalId === requested?.request.id,
  );
  assert(
    resolvedIndex > events.indexOf(requested),
    "Approval continuation must emit approval.resolved after approval.requested.",
  );
  const resolved = events[resolvedIndex];
  assert(
    resolved?.type === "approval.resolved" &&
      resolved.response.decision === "approve",
    "Approval continuation must preserve the explicit provider-neutral decision.",
  );
  return events.length;
}

async function assertQueueIdentity(input: {
  transport: AgentTransport;
  threadId: string;
  timeoutMs: number;
}): Promise<number> {
  const { transport, threadId } = input;
  assert(
    transport.queueMessage &&
      transport.listQueuedMessages &&
      transport.steerQueuedMessage,
    "messageQueue requires queue, list, and steer operations.",
  );
  const queued = parseAgentQueuedMessage(
    (
      await transport.queueMessage({
        threadId,
        text: "Promote this exact queued message.",
        metadata: { "x-agentkit-conformance": true },
      })
    ).message,
  );
  assert(
    queued.threadId === threadId,
    "Queued messages must preserve thread identity.",
  );
  assert(queued.id.length > 0, "Queued messages must receive a stable id.");
  const before = await transport.listQueuedMessages({ threadId });
  assert(
    before.some((message) => message.id === queued.id),
    "Queue listing must preserve the id returned by queueMessage.",
  );

  let wrongIdentityRejected = false;
  try {
    await transport.steerQueuedMessage({
      threadId,
      messageId: `${queued.id}-unknown`,
    });
  } catch {
    wrongIdentityRejected = true;
  }
  assert(
    wrongIdentityRejected,
    "Queue steering must reject an unknown message id.",
  );
  assert(
    (await transport.listQueuedMessages({ threadId })).some(
      (message) => message.id === queued.id,
    ),
    "Rejected steering must leave the original queued item intact.",
  );

  const promoted = await transport.steerQueuedMessage({
    threadId,
    messageId: queued.id,
  });
  assert(
    !(await transport.listQueuedMessages({ threadId })).some(
      (message) => message.id === queued.id,
    ),
    "Successful steering must remove the exact queued item.",
  );

  if (promoted) {
    const events = await collect(
      transport.subscribeToRun({ threadId, runId: promoted.runId }),
      input.timeoutMs,
      "queue promotion run",
    );
    assertOrderedEvents({
      events,
      threadId,
      runId: promoted.runId,
      terminal: "run.completed",
    });
    const promotedMessages = events.filter(
      (event): event is Extract<AgentEvent, { type: "message.created" }> =>
        event.type === "message.created" && event.message.id === queued.id,
    );
    assert(
      promotedMessages.length === 1,
      "Queue promotion must create exactly one user message with the queued id.",
    );
    return events.length;
  }

  assert(
    transport.getThreadSnapshot,
    "Void queue steering requires a thread snapshot.",
  );
  const snapshot = await transport.getThreadSnapshot({ threadId });
  assert(snapshot !== null, "Queue promotion must preserve its thread.");
  assert(
    snapshot.messages.filter((message) => message.id === queued.id).length ===
      1,
    "Void queue steering must persist exactly one user message with the queued id.",
  );
  return 0;
}

async function assertTerminalFailure(input: {
  transport: AgentTransport;
  threadId: string;
  timeoutMs: number;
}): Promise<number> {
  const started = await startScenarioRun({
    ...input,
    scenario: "terminal-failure",
  });
  const events = await collect(
    input.transport.subscribeToRun({
      threadId: input.threadId,
      runId: started.runId,
    }),
    input.timeoutMs,
    "terminal failure stream",
  );
  assertOrderedEvents({
    events,
    threadId: input.threadId,
    runId: started.runId,
    terminal: "run.failed",
  });
  const terminal = events.at(-1);
  assert(
    terminal?.type === "run.failed" &&
      terminal.error.code.length > 0 &&
      terminal.error.message.length > 0,
    "run.failed must preserve a non-empty error code and message.",
  );
  await assertRunSnapshot(
    input.transport,
    input.threadId,
    started.runId,
    terminal,
  );
  return events.length;
}

/**
 * Runs provider-neutral invariants against an AgentKit transport. Supplying a
 * scenario factory executes cancellation, disconnect, reconnect, isolation,
 * approval, queue, and failure paths against fresh deterministic backends.
 */
export async function assertAgentTransportConformance(
  options: AgentKitConformanceOptions,
): Promise<AgentKitConformanceReport> {
  const threadId = options.threadId ?? "agentkit-conformance-thread";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const isUnsupportedError = options.isUnsupportedError ?? unsupportedByDefault;
  const profile = options.createTransport ? "full" : "baseline";
  const baselineTransport = options.createTransport
    ? await options.createTransport("completed")
    : options.transport;
  const ownsBaselineTransport = options.createTransport !== undefined;
  try {
    const capabilities = await readCapabilities(baselineTransport);
    assertCapabilitiesTruthful(baselineTransport, capabilities);
    await assertUnsupportedOperations(
      baselineTransport,
      capabilities,
      isUnsupportedError,
      threadId,
    );
    const baseline = await assertBaseline({
      transport: baselineTransport,
      capabilities,
      threadId,
      messages: options.messages,
      timeoutMs,
    });

    const checks = [
      "capabilities truthfulness",
      "unsupported operations",
      "event ordering/deduplication",
      "terminal completion",
      "terminal activity projection",
      "version compatibility",
      ...(capabilities.resumableRuns ? ["cursor replay"] : []),
      ...(baselineTransport.getRun ? ["run snapshot"] : []),
      ...(baselineTransport.getThreadSnapshot ? ["thread snapshot"] : []),
      ...baseline.lifecycleChecks,
    ];
    let scenarioEventCount = 0;

    if (options.createTransport) {
      const runScenario = async <T>(
        scenario: AgentKitConformanceScenario,
        assertion: (transport: AgentTransport) => Promise<T>,
      ): Promise<T> => {
        const transport = await options.createTransport(scenario);
        try {
          const scenarioCapabilities = await readCapabilities(transport);
          sameCapabilities(capabilities, scenarioCapabilities, scenario);
          assertCapabilitiesTruthful(transport, scenarioCapabilities);
          return await assertion(transport);
        } finally {
          await transport.dispose?.();
        }
      };

      scenarioEventCount += await runScenario("cancellation", (transport) =>
        assertCancellation({
          transport,
          threadId: `${threadId}-cancellation`,
          timeoutMs,
        }),
      );
      checks.push("cancellation");

      scenarioEventCount += await runScenario("abort", (transport) =>
        assertAbortDisconnect({
          transport,
          capabilities,
          threadId: `${threadId}-abort`,
          timeoutMs,
        }),
      );
      checks.push("abort/disconnect");

      if (capabilities.resumableRuns) {
        scenarioEventCount += await runScenario("reconnect", (transport) =>
          assertReconnectInterruption({
            transport,
            threadId: `${threadId}-reconnect`,
            timeoutMs,
          }),
        );
        checks.push("reconnect interruption");
      }

      scenarioEventCount += await runScenario("cross-thread", (transport) =>
        assertCrossThreadIsolation({
          transport,
          threadId: `${threadId}-isolation`,
          timeoutMs,
        }),
      );
      checks.push("cross-thread isolation");

      if (capabilities.messageQueue) {
        scenarioEventCount += await runScenario("queue", (transport) =>
          assertQueueIdentity({
            transport,
            threadId: `${threadId}-queue`,
            timeoutMs,
          }),
        );
        checks.push("queue identity/steering");
      }

      if (capabilities.approvals) {
        scenarioEventCount += await runScenario("approval", (transport) =>
          assertApprovalContinuation({
            transport,
            threadId: `${threadId}-approval`,
            timeoutMs,
          }),
        );
        checks.push("approval continuation");
      }

      scenarioEventCount += await runScenario("terminal-failure", (transport) =>
        assertTerminalFailure({
          transport,
          threadId: `${threadId}-failure`,
          timeoutMs,
        }),
      );
      checks.push("terminal failure");
    }

    return {
      profile,
      runId: baseline.runId,
      eventCount: baseline.events.length,
      replayedEventCount: baseline.replay.length,
      scenarioEventCount,
      capabilities,
      checks,
    };
  } finally {
    if (ownsBaselineTransport) await baselineTransport.dispose?.();
  }
}
