import { z } from "zod";

import type {
  AiTurnRequest,
  AiTurnResult,
  InboxResult,
  OperationRequest,
  OperationResult,
} from "../adapter.js";
import { OPERATION_CATALOG } from "../catalog/index.js";
import {
  threadRefSchema,
  workflowErrorCodeSchema,
  type WorkflowGraph,
} from "../contract.js";
import { normalizedItemSchema } from "../items.js";
import { STORY_GRAPHS, type StoryKey } from "../story-graphs.fixture.js";
import type { AiResponder, ScriptedOperation } from "./fakes.js";
import {
  STORY_START,
  SimulatedCrash,
  runStoryScript,
  type StoryRun,
  type StoryStep,
} from "./story-harness.js";

// A story's script, fixtures and expectations are plain JSON. This file is the
// whole contract between that data and the engine: it validates the data,
// compiles a scenario into harness steps, runs it, and boils the run down to a
// transcript that holds nothing but what a person would check (counts, ports,
// the calls that went out and their receipts, where items ended or wait).
// Nothing here imports a test framework, so a local seed action can replay the
// same scenario.

const OFFSET = /^\+(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/;
const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

/** An ISO instant, or an offset from the scenario's start such as `+5m`, `+24h` or `+3d12h`. */
const instantSchema = z
  .string()
  .refine(
    (value) =>
      INSTANT.test(value) ||
      (OFFSET.test(value) && value !== "+" && /\d/.test(value)),
    "use an ISO instant, or an offset from the start like +5m, +24h or +3d",
  );

export function resolveInstant(value: string, start: string): string {
  const offset = OFFSET.exec(value);
  if (!offset) return new Date(value).toISOString();
  const [, days, hours, minutes] = offset;
  const ms =
    (Number(days ?? 0) * 24 * 60 +
      Number(hours ?? 0) * 60 +
      Number(minutes ?? 0)) *
    60_000;
  return new Date(Date.parse(start) + ms).toISOString();
}

/**
 * A list of items, written out or generated: `count` copies of `template` in
 * which `{i}` is the copy's number from 1, so a story can offer 150 commits
 * without writing them.
 */
const itemListSchema = z.union([
  z.array(normalizedItemSchema),
  z.strictObject({
    count: z.number().int().min(1).max(1000),
    template: z.record(z.string(), z.unknown()),
  }),
]);

function itemsOf(list: z.infer<typeof itemListSchema>) {
  if (Array.isArray(list)) return list;
  const fillIndex = (value: unknown, index: number): unknown => {
    if (typeof value === "string") {
      return value.split("{i}").join(String(index));
    }
    if (Array.isArray(value))
      return value.map((entry) => fillIndex(entry, index));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          fillIndex(entry, index),
        ]),
      );
    }
    return value;
  };
  return Array.from({ length: list.count }, (_, index) =>
    normalizedItemSchema.parse(fillIndex(list.template, index + 1)),
  );
}

const providerSuccessSchema = z.strictObject({
  ok: z.literal(true),
  output: z.unknown().optional(),
  items: itemListSchema.optional(),
  totalAvailable: z.number().int().min(0).optional(),
  cursor: z.string().optional(),
  externalRef: z.string().optional(),
  url: z.string().optional(),
});
const providerFailureSchema = z.strictObject({
  ok: z.literal(false),
  code: workflowErrorCodeSchema,
  message: z.string().optional(),
  retryable: z.boolean().optional(),
  sideEffect: z.enum(["none", "maybe", "done"]).optional(),
});
/** The call went out, and then the process died before the engine heard back. */
const providerCrashSchema = z.strictObject({ crash: z.literal("after-call") });
const providerAnswerSchema = z.union([
  providerSuccessSchema,
  providerFailureSchema,
  providerCrashSchema,
]);
const providerRecordingSchema = z.union([
  providerAnswerSchema,
  // Answers chosen by what was asked: the first entry whose `when` fields all equal the request's, or the first with none.
  z.strictObject({
    match: z
      .array(
        z.strictObject({
          when: z.record(z.string(), z.unknown()).optional(),
          answer: providerAnswerSchema,
        }),
      )
      .min(1),
  }),
]);
type ProviderAnswer = z.infer<typeof providerAnswerSchema>;
type ProviderRecording = z.infer<typeof providerRecordingSchema>;

const aiFailureCodeSchema = z.enum([
  "no_result",
  "result_invalid",
  "timeout",
  "budget",
  "credentials",
  "engine_error",
]);
const aiRecordingSchema = z.union([
  z.strictObject({
    perItem: z.record(
      z.string(),
      z.union([
        z.strictObject({
          fail: aiFailureCodeSchema,
          reason: z.string().optional(),
        }),
        z.record(z.string(), z.unknown()),
      ]),
    ),
    threadId: z.string().optional(),
  }),
  z.strictObject({
    wholeList: z.record(z.string(), z.unknown()),
    threadId: z.string().optional(),
  }),
  z.strictObject({
    failed: z.strictObject({ code: aiFailureCodeSchema, reason: z.string() }),
  }),
]);
type AiRecording = z.infer<typeof aiRecordingSchema>;

const inboxRecordingSchema = z.union([
  z.strictObject({
    items: itemListSchema,
    totalAvailable: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    failed: z.strictObject({
      code: workflowErrorCodeSchema,
      message: z.string(),
      retryable: z.boolean().optional(),
    }),
  }),
]);

const named = <T extends z.ZodType>(recording: T) =>
  z.record(z.string(), z.record(z.string(), recording));

/**
 * Recorded answers, by name. Provider answers are keyed by operation id,
 * because that is all the executor is asked for: two nodes that call the same
 * operation are told apart by `match`. Model answers and inbox offers are
 * keyed by the node that asks.
 */
export const storyFixturesSchema = z.strictObject({
  provider: named(providerRecordingSchema),
  ai: named(aiRecordingSchema),
  inbox: named(inboxRecordingSchema),
});
export type StoryFixtures = z.infer<typeof storyFixturesSchema>;

const callsSchema = z.number().int().min(1).optional();
const stepSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("clock"), at: instantSchema }),
  /** What an operation answers from now on, or for the next `calls` calls. */
  z.strictObject({
    kind: z.literal("serve"),
    operation: z.string().min(1),
    recording: z.string().min(1),
    calls: callsSchema,
  }),
  /** What an inbox source node's poller offers on its next takes. */
  z.strictObject({
    kind: z.literal("offer"),
    source: z.string().min(1),
    recording: z.string().min(1),
    calls: callsSchema,
  }),
  /** What a node's model answers from now on, or for its next `calls` turns. */
  z.strictObject({
    kind: z.literal("ai"),
    node: z.string().min(1),
    recording: z.string().min(1),
    calls: callsSchema,
  }),
  /** A person (or a bot) writes in a thread, or reacts to it. */
  z.strictObject({
    kind: z.literal("reply"),
    thread: threadRefSchema,
    at: instantSchema,
    author: z.string().min(1),
    text: z.string().optional(),
    bot: z.boolean().optional(),
    reaction: z.string().optional(),
  }),
  /** The next reads of any thread fail, so "could not read" is told from "nobody answered". */
  z.strictObject({
    kind: z.literal("threadReadFails"),
    count: z.number().int().min(1),
    code: workflowErrorCodeSchema.optional(),
    message: z.string().optional(),
    retryable: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("strandLease"),
    itemIds: z.array(z.string().min(1)).min(1),
  }),
  z.strictObject({ kind: z.literal("restart") }),
  /** The scheduler fires. A manual tick runs the new-items pass whatever the Trigger says. */
  z.strictObject({
    kind: z.literal("tick"),
    label: z.string().optional(),
    at: instantSchema.optional(),
    manual: z.boolean().optional(),
    mode: z.enum(["live", "dry", "test"]).optional(),
    /** A `test` tick runs only this node, on `sample` items when given. */
    node: z.string().min(1).optional(),
    sample: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          item: z.record(z.string(), z.unknown()),
          nodes: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .optional(),
  }),
]);
export type StoryDataStep = z.infer<typeof stepSchema>;

const scenarioSchema = z.strictObject({
  /** What this timeline proves, in a sentence. */
  description: z.string().min(1),
  start: instantSchema.optional(),
  steps: z.array(stepSchema).min(1),
});
export type StoryScenario = z.infer<typeof scenarioSchema>;

/** The scenarios of one story, by name. Each runs on a fresh world. */
export const storyScriptSchema = z.strictObject({
  scenarios: z.record(z.string().min(1), scenarioSchema),
});
export type StoryScriptData = z.infer<typeof storyScriptSchema>;

// ---------------------------------------------------------------------------
// Compiling a scenario into harness steps.

function get(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** `{n}` is the call's number for its operation (`{n:6}` pads it), `{fields.x}` a field of the request. */
function fill(value: unknown, request: OperationRequest, n: number): unknown {
  if (typeof value === "string") {
    return value
      .replace(/\{n(?::(\d+))?\}/g, (_, pad: string | undefined) =>
        String(n).padStart(pad === undefined ? 0 : Number(pad), "0"),
      )
      .replace(/\{fields\.([A-Za-z0-9_.]+)\}/g, (_, path: string) => {
        const found = get(request.fields, path);
        if (found === undefined) {
          throw new Error(
            `A recorded answer for ${request.operation.id} reads {fields.${path}}, which the request did not have.`,
          );
        }
        return String(found);
      });
  }
  if (Array.isArray(value))
    return value.map((entry) => fill(entry, request, n));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        fill(entry, request, n),
      ]),
    );
  }
  return value;
}

function isSubset(
  when: Readonly<Record<string, unknown>>,
  fields: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(when).every(
    ([key, expected]) =>
      JSON.stringify(fields[key]) === JSON.stringify(expected),
  );
}

function answerOf(
  answer: ProviderAnswer,
  request: OperationRequest,
  n: number,
): OperationResult {
  if ("crash" in answer) {
    throw new SimulatedCrash("the process died after the call went out");
  }
  if (!answer.ok) {
    return {
      ok: false,
      code: answer.code,
      message: answer.message ?? `${answer.code} from the recording`,
      retryable: answer.retryable ?? false,
      sideEffect: answer.sideEffect ?? "none",
    };
  }
  const externalRef = fill(answer.externalRef, request, n);
  const url = fill(answer.url, request, n);
  return {
    ok: true,
    output: fill(answer.output, request, n),
    ...(answer.items === undefined ? {} : { items: itemsOf(answer.items) }),
    ...(answer.totalAvailable === undefined
      ? {}
      : { totalAvailable: answer.totalAvailable }),
    ...(answer.cursor === undefined ? {} : { cursor: answer.cursor }),
    ...(typeof externalRef === "string" ? { externalRef } : {}),
    ...(typeof url === "string" ? { url } : {}),
  };
}

function scriptedOperation(
  recording: ProviderRecording,
  counter: { n: number },
): ScriptedOperation {
  return (request) => {
    counter.n += 1;
    if (!("match" in recording)) return answerOf(recording, request, counter.n);
    const entry = recording.match.find(
      (candidate) =>
        candidate.when === undefined ||
        isSubset(candidate.when, request.fields),
    );
    if (!entry) {
      throw new Error(
        `No recording of ${request.operation.id} matches this request: ${JSON.stringify(request.fields).slice(0, 300)}`,
      );
    }
    return answerOf(entry.answer, request, counter.n);
  };
}

type AiGraph = Pick<WorkflowGraph, "nodes">;

/** The node a model turn belongs to, from the instruction it was given. */
function nodeByInstruction(graph: AiGraph): Map<string, string> {
  const nodes = new Map<string, string>();
  const claim = (instruction: string, node: string): void => {
    const other = nodes.get(instruction);
    if (other !== undefined && other !== node) {
      throw new Error(
        `"${other}" and "${node}" give the model the same instruction, so a recording cannot tell them apart.`,
      );
    }
    nodes.set(instruction, node);
  };
  for (const node of graph.nodes) {
    if (node.kind === "ai") claim(node.settings.instruction, node.name);
    if (
      node.kind === "action" ||
      node.kind === "agent" ||
      node.kind === "lookup"
    ) {
      const written = Object.entries(node.settings.args).flatMap(
        ([name, binding]) =>
          binding.mode === "ai"
            ? [{ name, instruction: binding.instruction }]
            : [],
      );
      if (written.length === 0) continue;
      // The engine asks for all of a node's model-written fields in one turn.
      claim(
        written.length === 1
          ? written[0].instruction
          : `Write each of these fields:\n${written.map((entry) => `- ${entry.name}: ${entry.instruction}`).join("\n")}`,
        node.name,
      );
    }
  }
  return nodes;
}

function aiResult(
  recording: AiRecording,
  request: AiTurnRequest,
  node: string,
): AiTurnResult {
  const usage = { modelCalls: 1 };
  if ("failed" in recording) {
    return { ok: false, ...recording.failed, usage };
  }
  const threadId =
    "threadId" in recording && recording.threadId !== undefined
      ? { threadId: recording.threadId }
      : {};
  if ("wholeList" in recording) {
    if (request.mode !== "wholeList") {
      throw new Error(
        `"${node}" was asked per item; its recording answers the whole list.`,
      );
    }
    return {
      ok: true,
      mode: "wholeList",
      usage,
      fields: recording.wholeList,
      ...threadId,
    };
  }
  if (request.mode !== "perItem") {
    throw new Error(
      `"${node}" was asked for the whole list; its recording answers per item.`,
    );
  }
  return {
    ok: true,
    mode: "perItem",
    usage,
    ...threadId,
    results: request.items.map((item) => {
      const answer = recording.perItem[item.id] ?? recording.perItem["*"];
      if (answer === undefined) {
        throw new Error(
          `The recording for "${node}" has no answer for item "${item.id}" and no "*" fallback.`,
        );
      }
      if (typeof answer.fail === "string") {
        return {
          itemId: item.id,
          ok: false as const,
          code: answer.fail as z.infer<typeof aiFailureCodeSchema>,
          reason:
            typeof answer.reason === "string"
              ? answer.reason
              : "failed in the recording",
        };
      }
      return { itemId: item.id, ok: true as const, fields: answer };
    }),
  };
}

/** What each node's model will answer, replaced step by step as a scenario moves on. */
class AiServes {
  private readonly queues = new Map<string, AiRecording[]>();
  private readonly standing = new Map<string, AiRecording>();

  serve(node: string, recording: AiRecording, calls: number | undefined): void {
    if (calls === undefined) {
      this.standing.set(node, recording);
      return;
    }
    const queue = this.queues.get(node) ?? [];
    for (let index = 0; index < calls; index += 1) queue.push(recording);
    this.queues.set(node, queue);
  }

  next(node: string): AiRecording | undefined {
    return this.queues.get(node)?.shift() ?? this.standing.get(node);
  }
}

function lookup<T>(
  table: Readonly<Record<string, Readonly<Record<string, T>>>>,
  key: string,
  name: string,
  what: string,
): T {
  const found = table[key]?.[name];
  if (found === undefined) {
    throw new Error(`No recording "${name}" under ${what} "${key}".`);
  }
  return found;
}

function sourceKind(graph: AiGraph, node: string): "inbox-poll" | "status" {
  const found = graph.nodes.find((candidate) => candidate.name === node);
  if (
    found?.kind !== "source" ||
    (found.settings.source !== "inbox-poll" &&
      found.settings.source !== "status")
  ) {
    throw new Error(
      `"${node}" is not an inbox-poll or status source, so nothing is offered to it.`,
    );
  }
  return found.settings.source;
}

function compile(
  graph: WorkflowGraph,
  scenario: StoryScenario,
  fixtures: StoryFixtures,
): { start: string; steps: StoryStep[] } {
  const start = scenario.start
    ? resolveInstant(scenario.start, STORY_START)
    : STORY_START;
  const at = (value: string): string => resolveInstant(value, start);
  const counters = new Map<string, { n: number }>();
  const serves = new AiServes();
  const instructions = nodeByInstruction(graph);
  const router: AiResponder = (request) => {
    const node = instructions.get(request.instruction);
    if (node === undefined) {
      throw new Error(
        `No node of this graph gave the model this instruction: ${request.instruction.slice(0, 80)}`,
      );
    }
    const recording = serves.next(node);
    if (recording === undefined) {
      throw new Error(`No model answer is being served for "${node}".`);
    }
    return aiResult(recording, request, node);
  };

  const steps: StoryStep[] = [{ kind: "ai", thenAlways: router }];
  for (const step of scenario.steps) {
    switch (step.kind) {
      case "clock":
        steps.push({ kind: "clock", at: at(step.at) });
        break;
      case "serve": {
        const counter = counters.get(step.operation) ?? { n: 0 };
        counters.set(step.operation, counter);
        const answer = scriptedOperation(
          lookup(
            fixtures.provider,
            step.operation,
            step.recording,
            "operation",
          ),
          counter,
        );
        steps.push(
          step.calls === undefined
            ? {
                kind: "provider",
                operation: step.operation,
                thenAlways: answer,
              }
            : {
                kind: "provider",
                operation: step.operation,
                answers: Array.from({ length: step.calls }, () => answer),
              },
        );
        break;
      }
      case "offer": {
        const recording = lookup(
          fixtures.inbox,
          step.source,
          step.recording,
          "source",
        );
        const result: InboxResult =
          "failed" in recording
            ? {
                ok: false,
                code: recording.failed.code,
                message: recording.failed.message,
                retryable: recording.failed.retryable ?? false,
              }
            : {
                ok: true,
                items: itemsOf(recording.items),
                ...(recording.totalAvailable === undefined
                  ? {}
                  : { totalAvailable: recording.totalAvailable }),
              };
        const source = sourceKind(graph, step.source);
        steps.push(
          step.calls === undefined
            ? { kind: "inbox", source, thenAlways: result }
            : {
                kind: "inbox",
                source,
                results: Array.from({ length: step.calls }, () => result),
              },
        );
        break;
      }
      case "ai": {
        if (!graph.nodes.some((node) => node.name === step.node)) {
          throw new Error(`"${step.node}" is not a node of this graph.`);
        }
        const recording = lookup(
          fixtures.ai,
          step.node,
          step.recording,
          "node",
        );
        steps.push({
          kind: "call",
          run: () => serves.serve(step.node, recording, step.calls),
        });
        break;
      }
      case "reply":
        steps.push({
          kind: "slack",
          thread: step.thread,
          at: at(step.at),
          author: step.author,
          ...(step.text === undefined ? {} : { text: step.text }),
          ...(step.bot === undefined ? {} : { bot: step.bot }),
          ...(step.reaction === undefined ? {} : { reaction: step.reaction }),
        });
        break;
      case "threadReadFails":
        steps.push({
          kind: "call",
          run: ({ test }) =>
            void test.threads.failNext(step.count, {
              ...(step.code === undefined ? {} : { code: step.code }),
              ...(step.message === undefined ? {} : { message: step.message }),
              ...(step.retryable === undefined
                ? {}
                : { retryable: step.retryable }),
            }),
        });
        break;
      case "strandLease":
        steps.push({ kind: "strandLease", itemIds: step.itemIds });
        break;
      case "restart":
        steps.push({ kind: "restart" });
        break;
      case "tick":
        steps.push({
          kind: "tick",
          ...(step.label === undefined ? {} : { label: step.label }),
          ...(step.at === undefined ? {} : { at: at(step.at) }),
          ...(step.manual === undefined ? {} : { manual: step.manual }),
          ...(step.mode === undefined ? {} : { mode: step.mode }),
          ...(step.node === undefined ? {} : { testNodeId: step.node }),
          ...(step.sample === undefined ? {} : { sampleItems: step.sample }),
        });
        break;
    }
  }
  return { start, steps };
}

// ---------------------------------------------------------------------------
// The transcript: what a scenario did, with nothing a clock or a counter chose.

export interface NodeSummary {
  /** Items that reached the node. */
  in: number;
  /** Items sent out of each port, only the ports that sent any. A Wait's `parked` is a count, not a port. */
  ports: Record<string, number>;
  status?: string;
  error?: string;
  /** The provider had this many; the node took fewer. */
  truncatedFrom?: number;
}

export interface EffectSummary {
  node: string;
  item: string;
  operation: string;
  fields: Record<string, unknown>;
  receipt: { status: string; externalRef?: string; url?: string } | null;
}

export interface TickSummary {
  label?: string;
  at: string;
  mode?: "dry" | "test";
  outcome: string;
  run?: { status: string; counts: Record<string, number>; error?: string };
  nodes: Record<string, NodeSummary>;
  /** Provider calls by operation, reads and writes. */
  calls: Record<string, number>;
  /** The span a window source was asked to read. */
  windows: Record<string, { from: string; to: string }>;
  effects: EffectSummary[];
  ai: { node: string; mode: string; items: string[]; tools?: string[] }[];
  crash?: string;
}

export interface ParkedSummary {
  item: string;
  node: string;
  wait: string;
  dueAt: string;
  nextCheckAt?: string;
  thread?: Record<string, unknown>;
  counters?: Record<string, number>;
}

export interface ScenarioSummary {
  ticks: TickSummary[];
  /** Items waiting at a Wait when the scenario ended, and until when. */
  parked: ParkedSummary[];
  /** The last inbox status each item was given. */
  statuses: Record<string, string>;
  /** What End nodes recorded on each item, when any did. */
  recorded?: Record<string, Record<string, unknown>>;
  /** Source cursors saved, by source node. */
  cursors: Record<string, string>;
  /** What happened to each item, in order: decisions, effects, parking, waking, how it ended, why it failed. */
  journeys: Record<string, string[]>;
}

function decodeKey(key: string): { item: string; node: string } {
  const [, item, node] = key.split(":").map(decodeURIComponent);
  return { item, node };
}

export async function summarizeRun(
  run: StoryRun,
  graph: WorkflowGraph,
): Promise<ScenarioSummary> {
  const { test } = run.world;
  const store = run.world.store();
  const instructions = nodeByInstruction(graph);
  const ticks: TickSummary[] = [];

  for (const tick of run.ticks) {
    const nodes: Record<string, NodeSummary> = {};
    for (const step of tick.steps) {
      const ports = Object.fromEntries(
        Object.entries(step.ports)
          .filter(([, entry]) => entry.count > 0)
          .map(([port, entry]) => [port, entry.count]),
      );
      const received = typeof step.fields?.in === "number" ? step.fields.in : 0;
      if (
        received === 0 &&
        Object.keys(ports).length === 0 &&
        step.status === "succeeded"
      ) {
        continue;
      }
      nodes[step.nodeId] = {
        in: received,
        ports,
        ...(step.status === "succeeded" ? {} : { status: step.status }),
        ...(step.error === undefined ? {} : { error: step.error.code }),
        ...(step.truncated === undefined
          ? {}
          : { truncatedFrom: step.truncated.totalAvailable }),
      };
    }

    const calls: Record<string, number> = {};
    const windows: TickSummary["windows"] = {};
    const effects: EffectSummary[] = [];
    for (const call of tick.calls) {
      const id = call.operation.id;
      calls[id] = (calls[id] ?? 0) + 1;
      const window = OPERATION_CATALOG.get(id)?.window;
      if (window) {
        windows[id] = {
          from: String(call.fields[window.fromParam]),
          to: String(call.fields[window.toParam]),
        };
      }
      if (call.receiptKey !== undefined) {
        const receipt = await store.getReceipt(test.scope, call.receiptKey);
        const { node, item } = decodeKey(call.receiptKey);
        effects.push({
          node,
          item,
          operation: id,
          fields: { ...call.fields },
          receipt: receipt
            ? {
                status: receipt.status,
                ...(receipt.externalRef === undefined
                  ? {}
                  : { externalRef: receipt.externalRef }),
                ...(receipt.url === undefined ? {} : { url: receipt.url }),
              }
            : null,
        });
      }
    }

    const ran = tick.result?.kind === "ran" ? tick.result : undefined;
    const mode = ran?.run.mode;
    ticks.push({
      ...(tick.label === undefined ? {} : { label: tick.label }),
      at: tick.at,
      ...(mode === "dry" || mode === "test" ? { mode } : {}),
      outcome: tick.outcome,
      ...(ran
        ? {
            run: {
              status: ran.run.status,
              counts: Object.fromEntries(
                Object.entries(ran.run.counts).filter(([, n]) => n !== 0),
              ),
              ...(ran.run.error === undefined
                ? {}
                : { error: ran.run.error.code }),
            },
          }
        : {}),
      nodes,
      calls,
      windows,
      effects,
      ai: tick.aiRequests.map((request) => ({
        node: instructions.get(request.instruction) ?? "(unknown)",
        mode: request.mode,
        items: request.items.map((item) => item.id),
        ...(request.tools.length > 0 ? { tools: [...request.tools] } : {}),
      })),
      ...(tick.crash === undefined ? {} : { crash: tick.crash }),
    });
  }

  const journeys: Record<string, string[]> = {};
  for (const [itemId, events] of Object.entries(run.events)) {
    const steps = events.flatMap((event): string[] => {
      const where = event.nodeId ?? "?";
      switch (event.kind) {
        case "decision":
          return [`decision@${where}:${event.port ?? "?"}`];
        case "effect":
          return [`effect@${where}`];
        case "parked":
          return [`parked@${where}`];
        case "woke":
          return [`woke@${where}:${event.port ?? "?"}`];
        case "ended":
          return [`ended@${where}:${event.outcome}`];
        case "error":
          return [`error@${where}:${event.code}`];
        default:
          return [];
      }
    });
    if (steps.length > 0) journeys[itemId] = steps;
  }

  const cursors: Record<string, string> = {};
  for (const node of graph.nodes) {
    if (node.kind !== "source") continue;
    const cursor = await store.getSourceCursor(test.scope, {
      workflowId: run.workflowId,
      nodeId: node.id,
    });
    if (cursor) cursors[node.id] = cursor.value;
  }

  return {
    ticks,
    parked: run.parked.map((row) => ({
      item: row.itemId,
      node: row.parkedAtNode ?? "?",
      wait: row.wake?.wait ?? "?",
      dueAt: row.wake?.dueAt ?? "?",
      ...(row.wake?.nextCheckAt === undefined
        ? {}
        : { nextCheckAt: row.wake.nextCheckAt }),
      ...(row.wake?.thread === undefined
        ? {}
        : { thread: { ...row.wake.thread } }),
      ...(Object.keys(row.counters).length === 0
        ? {}
        : { counters: { ...row.counters } }),
    })),
    statuses: run.statuses,
    ...(Object.keys(run.recorded).length > 0 ? { recorded: run.recorded } : {}),
    cursors,
    journeys,
  };
}

export interface ScenarioRun {
  run: StoryRun;
  summary: ScenarioSummary;
}

/** Runs one named scenario of a story on a fresh world and summarizes it. */
export async function runScenario(
  storyId: StoryKey,
  scenario: StoryScenario,
  fixtures: StoryFixtures,
): Promise<ScenarioRun> {
  const graph = STORY_GRAPHS[storyId];
  const { start, steps } = compile(graph, scenario, fixtures);
  const run = await runStoryScript(storyId, { start, steps });
  return { run, summary: await summarizeRun(run, graph) };
}

/** The script data compiled into harness steps, for a replay that runs them on a real store. */
export { compile as compileScenario };
