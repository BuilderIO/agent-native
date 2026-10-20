import type {
  AiTurnRequest,
  InboxResult,
  OperationRequest,
  WorkflowHost,
  WorkflowStore,
} from "../adapter.js";
import { OPERATION_CATALOG } from "../catalog/index.js";
import {
  SCHEDULE_STARTER,
  type ItemEvent,
  type ItemState,
  type Receipt,
  type RunMode,
  type StepRecord,
  type ThreadRef,
} from "../contract.js";
import {
  runTick,
  type SampleItem,
  type TickResult,
} from "../engine/run-tick.js";
import { STORY_GRAPHS, type StoryKey } from "../story-graphs.fixture.js";
import { startedByHand } from "./engine-fixtures.js";
import type { AiResponder, ScriptedOperation } from "./fakes.js";
import {
  createInMemoryStoreState,
  createInMemoryWorkflowStore,
} from "./in-memory-store.js";
import { makeHost, seedWorkflow, type TestHost } from "./make-host.js";

// Runs one of the ten stories through the real engine, the real operation
// catalog and the real graph, with fake providers, a fake Slack, a fake model
// and a clock the script moves. It imports nothing from a test framework, so a
// local seed action and a story folder can run the same script a spec does.

/** What a script throws from a provider answer to say the process died there. */
export class SimulatedCrash extends Error {
  constructor(message = "the process died") {
    super(message);
    this.name = "SimulatedCrash";
  }
}

/**
 * A provider answer that has its effect in the outside world and then kills the
 * process before the engine can close its receipt: the call went out, and the
 * engine never heard.
 */
export function crashAfter(effect: () => void): ScriptedOperation {
  return () => {
    effect();
    throw new SimulatedCrash("the process died after the call went out");
  };
}

/** The clock's first instant unless a script names one: a Monday at noon UTC. */
export const STORY_START = "2026-10-19T12:00:00.000Z";

export type StoryStep =
  /** Moves the clock. Ticks move it too, to the instant they name. */
  | { kind: "clock"; at: string }
  /** Queues provider answers for one operation, one per call; `thenAlways` answers once they run out. */
  | {
      kind: "provider";
      operation: string;
      answers?: readonly ScriptedOperation[];
      thenAlways?: ScriptedOperation;
    }
  /** Queues what the Slack, GitHub and Sentry pollers or the status source offer. */
  | {
      kind: "inbox";
      source: "inbox-poll" | "status";
      results?: readonly InboxResult[];
      thenAlways?: InboxResult;
    }
  /** Queues model answers in the order the nodes ask, or one that answers every turn. */
  | {
      kind: "ai";
      answers?: readonly AiResponder[];
      thenAlways?: AiResponder;
    }
  /** A message, or a reaction, appears in a thread. */
  | {
      kind: "slack";
      thread: ThreadRef;
      at: string;
      author: string;
      text?: string;
      bot?: boolean;
      reaction?: string;
    }
  /** Runs a function against the world as it stands now: the hook the data scripts compile to. */
  | { kind: "call"; run: (world: StoryWorld) => void | Promise<void> }
  /** A tick that died took these items and never gave them back. */
  | { kind: "strandLease"; itemIds: readonly string[] }
  /** The process restarts: a new store over the same rows; the outside world stays as it was. */
  | { kind: "restart" }
  /**
   * The job scheduler fires. A scheduled tick is keyed by its instant; a
   * manual one runs the new-items pass whatever the Trigger says.
   */
  | {
      kind: "tick";
      label?: string;
      at?: string;
      manual?: boolean;
      mode?: RunMode;
      /** A `test` tick runs this one node, on `sampleItems` when given. */
      testNodeId?: string;
      sampleItems?: readonly SampleItem[];
    };

export interface StoryScript {
  /** The clock's first instant. Default: `STORY_START`. */
  start?: string;
  steps: readonly StoryStep[];
}

export interface TranscriptTick {
  index: number;
  label?: string;
  at: string;
  outcome:
    | "ran"
    | "nothing_due"
    | "duplicate_tick"
    | "not_runnable"
    | "crashed";
  /** What `runTick` returned; absent when the process died. */
  result?: TickResult;
  /** The run this tick recorded, read back from the store, so a tick that died still shows what it did first. */
  runId?: string;
  crash?: string;
  steps: StepRecord[];
  /** Every provider call this tick made, reads and writes, in order; a call that killed the tick is the last. */
  calls: OperationRequest[];
  /** Every model turn this tick asked for, in order. */
  aiRequests: AiTurnRequest[];
}

export interface StoryTranscript {
  storyId: StoryKey;
  workflowId: string;
  ticks: TranscriptTick[];
  /** Every event of every item the run touched, oldest first. */
  events: Record<string, ItemEvent[]>;
  /** The receipt of every write any step named. */
  receipts: Receipt[];
  /** Items waiting at a Wait when the script ended (up to 20). */
  parked: ItemState[];
  /** The last inbox status written to each item. */
  statuses: Record<string, string>;
  /** What End nodes recorded on each item's extras, by item; an item nothing was recorded on has no entry. */
  recorded: Record<string, Record<string, unknown>>;
}

export interface StoryWorld {
  /** The fakes the script drove: operations, inbox, model, threads, status writer, clock. */
  test: TestHost;
  /** The store now, after any restart. */
  store(): WorkflowStore;
}

export type StoryRun = StoryTranscript & { world: StoryWorld };

const FAR_FUTURE = "2126-01-01T00:00:00.000Z";

function queue<T>(
  entries: readonly T[] | undefined,
  add: (entry: T) => void,
): void {
  for (const entry of entries ?? []) add(entry);
}

export async function runStoryScript(
  storyId: StoryKey,
  script: StoryScript,
): Promise<StoryRun> {
  const state = createInMemoryStoreState();
  const test = makeHost({
    catalog: OPERATION_CATALOG,
    state,
    start: script.start ?? STORY_START,
  });
  const seeded = await seedWorkflow(test, STORY_GRAPHS[storyId], {
    id: storyId,
  });
  const workflowId = seeded.id;
  let host: WorkflowHost = test.host;
  const ticks: TranscriptTick[] = [];
  const touched = new Set<string>();
  const receiptKeys = new Set<string>();
  const world: StoryWorld = { test, store: () => host.store };

  const newestRunId = async (): Promise<string | undefined> =>
    (await host.store.listRuns(test.scope, { workflowId, limit: 1 })).items[0]
      ?.id;

  for (const step of script.steps) {
    switch (step.kind) {
      case "clock":
        test.clock.set(step.at);
        break;
      case "provider":
        queue(step.answers, (answer) =>
          test.operations.script(step.operation, answer),
        );
        if (step.thenAlways) {
          test.operations.always(step.operation, step.thenAlways);
        }
        break;
      case "inbox":
        queue(step.results, (result) => test.inbox.script(step.source, result));
        if (step.thenAlways) test.inbox.always(step.source, step.thenAlways);
        break;
      case "ai":
        queue(step.answers, (answer) => test.ai.respond(answer));
        if (step.thenAlways) test.ai.always(step.thenAlways);
        break;
      case "slack":
        test.threads.post(step.thread, {
          at: step.at,
          author: step.author,
          ...(step.text === undefined ? {} : { text: step.text }),
          ...(step.bot === undefined ? {} : { bot: step.bot }),
          ...(step.reaction === undefined ? {} : { reaction: step.reaction }),
        });
        break;
      case "call":
        await step.run(world);
        break;
      case "strandLease":
        await host.store.leaseItems(test.scope, {
          workflowId,
          graphVersion: seeded.version,
          itemIds: step.itemIds,
          leasedBy: "dead-tick",
          now: test.clock.now().toISOString(),
        });
        break;
      case "restart":
        host = {
          ...test.host,
          store: createInMemoryWorkflowStore({
            clock: () => test.clock.now(),
            state,
          }),
        };
        break;
      case "tick": {
        const at = step.at ?? test.clock.now().toISOString();
        test.clock.set(at);
        const index = ticks.length;
        const before = await newestRunId();
        const callsBefore = test.operations.calls.length;
        const aiBefore = test.ai.requests.length;
        const mode = step.mode ?? "live";
        const scheduled = mode === "live" && !step.manual;
        let result: TickResult | undefined;
        let crash: string | undefined;
        try {
          result = await runTick({
            host,
            scope: test.scope,
            workflowId,
            tickKey: scheduled ? at : `manual-${index}`,
            mode,
            ...(step.testNodeId === undefined
              ? {}
              : { testNodeId: step.testNodeId }),
            ...(step.sampleItems === undefined
              ? {}
              : { sampleItems: step.sampleItems }),
            ...(scheduled
              ? {
                  triggerKind: "schedule" as const,
                  startedBy: SCHEDULE_STARTER,
                  scheduledFor: at,
                }
              : startedByHand(mode)),
          });
        } catch (error) {
          if (!(error instanceof SimulatedCrash)) throw error;
          crash = error.message;
        }
        const after = await newestRunId();
        const runId = after !== before ? after : undefined;
        let steps: StepRecord[] = [];
        if (runId !== undefined) {
          const stored = await host.store.getRun(test.scope, runId);
          if (!stored) {
            throw new Error(`Run "${runId}" was listed and then not found.`);
          }
          steps = stored.steps;
        }
        for (const recorded of steps) {
          for (const port of Object.values(recorded.ports)) {
            for (const itemId of port.itemIds) touched.add(itemId);
          }
          for (const key of recorded.receiptKeys ?? []) receiptKeys.add(key);
        }
        ticks.push({
          index,
          ...(step.label === undefined ? {} : { label: step.label }),
          at,
          outcome:
            crash === undefined ? (result?.kind ?? "crashed") : "crashed",
          ...(result ? { result } : {}),
          ...(runId === undefined ? {} : { runId }),
          ...(crash === undefined ? {} : { crash }),
          steps,
          calls: test.operations.calls.slice(callsBefore),
          aiRequests: test.ai.requests.slice(aiBefore),
        });
        break;
      }
    }
  }

  const parked = await host.store.listDueParked(test.scope, {
    workflowId,
    now: FAR_FUTURE,
  });
  for (const row of parked) touched.add(row.itemId);
  for (const written of test.statuses.written) touched.add(written.itemId);
  const events: Record<string, ItemEvent[]> = {};
  for (const itemId of touched) {
    events[itemId] = (
      await host.store.listItemEvents(test.scope, { workflowId, itemId })
    ).items;
  }
  const receipts: Receipt[] = [];
  for (const key of receiptKeys) {
    const receipt = await host.store.getReceipt(test.scope, key);
    if (receipt) receipts.push(receipt);
  }
  const statuses: Record<string, string> = {};
  for (const written of test.statuses.written) {
    statuses[written.itemId] = written.status;
  }
  const recorded: Record<string, Record<string, unknown>> = {};
  for (const [itemId, extras] of test.statuses.recordedExtras) {
    recorded[itemId] = { ...extras };
  }
  return {
    storyId,
    workflowId,
    ticks,
    events,
    receipts,
    parked,
    statuses,
    recorded,
    world,
  };
}
