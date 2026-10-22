import { createHash } from "node:crypto";

import { and, count, eq, inArray, sql } from "drizzle-orm";

import {
  factoryWorkflowItemEvents,
  factoryWorkflowItemState,
  factoryWorkflowReceipts,
  factoryWorkflowRuns,
  factoryWorkflowSteps,
  factoryWorkflows,
  triageItems,
} from "../db/schema.js";
import { orgFactoryItemFilter } from "../lib/factory-scope.js";
import type {
  InboxReader,
  ItemWriter,
  WorkflowHost,
  WorkflowScope,
  WorkflowStore,
} from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { RunMode, RunTriggerKind } from "../workflow/contract.js";
import { runTick } from "../workflow/engine/run-tick.js";
import { STORIES, type StoryBundle } from "../workflow/stories/registry.js";
import { makeHost } from "../workflow/testing/make-host.js";
import { compileScenario } from "../workflow/testing/story-data.js";
import {
  SimulatedCrash,
  type StoryStep,
  type StoryWorld,
} from "../workflow/testing/story-harness.js";
import { createItemsHost, type ItemsDatabase } from "./items.js";
import { createDrizzleWorkflowStore } from "./store.js";

// Replays a story's recorded scenario through the real engine, onto the real
// store and the real inbox rows, with fake providers, model, Slack and clock.
// Loaded lazily by `seed-story-run`: it pulls in every story's fixtures.

/** Recorded as `startedBy` on every run the replay makes. */
export const SEED_STARTER = "seed-story-run";
const SEED_VERSION_SUMMARY = "Seeded by seed-story-run";
const MARK_KEY = "seededBy";
const LISTED_IDS_MAX = 20;
const FAILURE_MESSAGE_MAX = 400;

export type SeedStoryErrorCode =
  | "story_not_found"
  | "scenario_not_found"
  | "workflow_name_taken"
  | "workflow_changed"
  | "scenario_conflict"
  | "partial_replay"
  | "replay_failed";

export class SeedStoryError extends Error {
  constructor(
    readonly code: SeedStoryErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SeedStoryError";
  }
}

export interface SeedStoryResult {
  storyId: string;
  scenario: string;
  workflowId: string;
  workflowName: string;
  created: { workflow: boolean; runs: number; items: number };
  reused: { workflow: boolean; runs: number; items: number };
  ticks: { total: number; ran: number; reused: number; crashed: number };
  runs: { total: number; ids: string[]; byStatus: Record<string, number> };
  items: { total: number; ids: string[]; parked: number };
}

export interface PurgeStoryResult {
  storyId: string;
  purged: {
    workflows: number;
    runs: number;
    steps: number;
    itemEvents: number;
    receipts: number;
    itemStates: number;
    items: number;
  };
}

export interface SeedStoryInput {
  scope: WorkflowScope;
  ownerEmail: string;
  story: StoryBundle;
  /** A scenario name; the story's first scenario when omitted. */
  scenario?: string;
  getDatabase: () => ItemsDatabase;
  /** Creates the workflow through the normal save path and returns its id. */
  saveWorkflow: (input: {
    name: string;
    graph: StoryBundle["graph"];
    summary: string;
  }) => Promise<{ workflowId: string }>;
}

export interface PurgeStoryInput {
  scope: WorkflowScope;
  story: StoryBundle;
  getDatabase: () => ItemsDatabase;
  /** Deletes a workflow, its job and everything under it, through the normal delete path. */
  deleteWorkflow: (workflowId: string) => Promise<void>;
}

export function resolveStory(storyId: string | number): StoryBundle {
  const wanted = String(storyId).trim().toLowerCase();
  const stories = Object.values(STORIES);
  const number = /^\d{1,2}$/.test(wanted) ? Number(wanted) : undefined;
  const found = stories.find(
    (story) =>
      story.key === wanted ||
      story.folder === wanted ||
      (number !== undefined && Number(story.folder.slice(0, 2)) === number),
  );
  if (!found) {
    throw new SeedStoryError(
      "story_not_found",
      `There is no story "${storyId}". Use a number from 1 to ${stories.length}, or one of: ${stories.map((story) => story.folder).join(", ")}.`,
      { stories: stories.map((story) => story.folder) },
    );
  }
  return found;
}

function resolveScenario(story: StoryBundle, scenario: string | undefined) {
  const names = Object.keys(story.script.scenarios);
  const name = scenario ?? names[0];
  const definition =
    name === undefined ? undefined : story.script.scenarios[name];
  if (name === undefined || definition === undefined) {
    throw new SeedStoryError(
      "scenario_not_found",
      `Story ${story.folder} has no scenario "${scenario}". Its scenarios are: ${names.join(", ")}.`,
      { scenarios: names },
    );
  }
  return { name, definition };
}

function seedMark(story: StoryBundle): string {
  return `${SEED_STARTER}:${story.folder}`;
}

/** The text a seeded row's `metadata_json` contains, so a row is told apart without parsing it. */
function markNeedle(story: StoryBundle): string {
  return `"${MARK_KEY}":${JSON.stringify(seedMark(story))}`;
}

function seedWorkflowName(story: StoryBundle): string {
  const title = story.key.replace(/-/g, " ");
  return `Seeded story ${story.folder.slice(0, 2)}: ${title.charAt(0).toUpperCase()}${title.slice(1)}`;
}

function scenarioPrefix(name: string): string {
  return `seed:${createHash("sha1").update(name).digest("hex").slice(0, 10)}:`;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : entry,
  );
}

const workflowScope = (scope: WorkflowScope) =>
  and(
    eq(factoryWorkflows.orgId, scope.orgId),
    eq(factoryWorkflows.factoryId, scope.factoryId),
  );

/** The workflows in this factory that carry the story's seeded name and were created by this action. */
async function findSeeded(
  db: ItemsDatabase,
  store: WorkflowStore,
  scope: WorkflowScope,
  story: StoryBundle,
): Promise<{ seeded: string[]; foreign: number }> {
  const rows = await db
    .select({ id: factoryWorkflows.id })
    .from(factoryWorkflows)
    .where(
      and(
        workflowScope(scope),
        eq(factoryWorkflows.name, seedWorkflowName(story)),
      ),
    );
  const seeded: string[] = [];
  for (const row of rows) {
    const first = await store.getWorkflowVersion(scope, row.id, 1);
    if (first?.summary === SEED_VERSION_SUMMARY) seeded.push(row.id);
  }
  return { seeded, foreign: rows.length - seeded.length };
}

async function countRows(
  db: ItemsDatabase,
  scope: WorkflowScope,
  story: StoryBundle,
  workflowId: string,
): Promise<{ runs: number; items: number }> {
  const [runs] = await db
    .select({ n: count() })
    .from(factoryWorkflowRuns)
    .where(
      and(
        eq(factoryWorkflowRuns.workflowId, workflowId),
        eq(factoryWorkflowRuns.orgId, scope.orgId),
        eq(factoryWorkflowRuns.factoryId, scope.factoryId),
        eq(factoryWorkflowRuns.startedBy, SEED_STARTER),
      ),
    );
  const [items] = await db
    .select({ n: count() })
    .from(triageItems)
    .where(seededItems(scope, story));
  return { runs: runs?.n ?? 0, items: items?.n ?? 0 };
}

function seededItems(scope: WorkflowScope, story: StoryBundle) {
  return and(
    orgFactoryItemFilter(scope.orgId, scope.factoryId),
    sql`strpos(${triageItems.metadataJson}, ${markNeedle(story)}) > 0`,
  );
}

/**
 * Items the replay writes carry the story's mark in their extras, which is how
 * a purge finds them. A row that exists without the mark is a real item, and
 * the replay refuses to touch it.
 */
function markingItemWriter(
  db: ItemsDatabase,
  scope: WorkflowScope,
  story: StoryBundle,
  items: ItemWriter,
): ItemWriter {
  const needle = markNeedle(story);
  return {
    setStatus: (request) => items.setStatus(request),
    async upsertItems({ items: offered, dryRun }) {
      if (dryRun !== true && offered.length > 0) {
        const rows = await db
          .select({
            id: triageItems.id,
            metadataJson: triageItems.metadataJson,
          })
          .from(triageItems)
          .where(
            and(
              orgFactoryItemFilter(scope.orgId, scope.factoryId),
              inArray(
                triageItems.id,
                offered.map((item) => item.id),
              ),
            ),
          );
        const foreign = rows.find((row) => !row.metadataJson.includes(needle));
        if (foreign) {
          return {
            ok: false,
            code: "item_conflict",
            message: `Item "${foreign.id}" already exists and was not seeded for story ${story.folder}, so the replay leaves it alone. Purge the other story or remove the item.`,
            retryable: false,
          };
        }
      }
      return items.upsertItems({
        items: offered.map((item) => ({
          ...item,
          extras: { ...item.extras, [MARK_KEY]: seedMark(story) },
        })),
        ...(dryRun === undefined ? {} : { dryRun }),
      });
    },
  };
}

/** What a real inbox does for the replay: rows exist for what it offers, and a handled row is not offered again. */
function storingInbox(fake: InboxReader, items: ItemWriter): InboxReader {
  return {
    takeRequeued: (request) => fake.takeRequeued(request),
    async take(request) {
      const result = await fake.take(request);
      if (!result.ok || request.mode !== "live") return result;
      const stored = await items.upsertItems({ items: result.items });
      if (!stored.ok) return stored;
      const handled = new Set(
        stored.states
          .filter((entry) => entry.state === "terminal")
          .map((entry) => entry.id),
      );
      return {
        ...result,
        items: result.items.filter((item) => !handled.has(item.id)),
      };
    },
  };
}

interface PlannedTick {
  at: string;
  key: string;
}

/** Each tick's instant and run key, worked out without running anything. */
function planTicks(
  start: string,
  steps: readonly StoryStep[],
  prefix: string,
): Map<StoryStep, PlannedTick> {
  const plan = new Map<StoryStep, PlannedTick>();
  let now = start;
  let index = 0;
  for (const step of steps) {
    if (step.kind === "clock") now = new Date(step.at).toISOString();
    if (step.kind !== "tick") continue;
    const at = step.at ?? now;
    now = at;
    const live = (step.mode ?? "live") === "live" && !step.manual;
    plan.set(step, { at, key: `${prefix}${live ? at : `#${index}`}` });
    index += 1;
  }
  return plan;
}

function starterFor(mode: RunMode): RunTriggerKind {
  // A seeded run is never `schedule`: the store reserves that starter for the scheduler.
  return mode === "dry" ? "dry_run" : mode === "test" ? "test" : "manual";
}

function failureText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > FAILURE_MESSAGE_MAX
    ? `${text.slice(0, FAILURE_MESSAGE_MAX)}...`
    : text;
}

export async function seedStory(
  input: SeedStoryInput,
): Promise<SeedStoryResult> {
  const { scope, story, getDatabase } = input;
  const db = getDatabase();
  const { name: scenario, definition } = resolveScenario(story, input.scenario);
  const prefix = scenarioPrefix(scenario);
  const lookup = createDrizzleWorkflowStore({ getDatabase });
  const workflowName = seedWorkflowName(story);

  const { seeded, foreign } = await findSeeded(db, lookup, scope, story);
  if (foreign > 0 && seeded.length === 0) {
    throw new SeedStoryError(
      "workflow_name_taken",
      `A workflow named "${workflowName}" already exists in this factory and was not created by seed-story-run. Rename or delete it first.`,
    );
  }
  let workflowId = seeded[0];
  const createdWorkflow = workflowId === undefined;
  if (workflowId === undefined) {
    workflowId = (
      await input.saveWorkflow({
        name: workflowName,
        graph: story.graph,
        summary: SEED_VERSION_SUMMARY,
      })
    ).workflowId;
  }
  const workflow = await lookup.getWorkflow(scope, workflowId);
  if (!workflow) {
    throw new SeedStoryError(
      "replay_failed",
      `Workflow "${workflowId}" was not found right after it was saved.`,
    );
  }
  if (canonical(workflow.graph) !== canonical(story.graph)) {
    throw new SeedStoryError(
      "workflow_changed",
      `The seeded workflow "${workflowName}" no longer matches story ${story.folder}'s graph (the story changed, or the workflow was edited). Purge it and seed again.`,
      { workflowId },
    );
  }

  const { start, steps } = compileScenario(
    story.graph,
    definition,
    story.fixtures,
  );
  const plan = planTicks(start, steps, prefix);
  const expectedKeys = new Set([...plan.values()].map((tick) => tick.key));
  const before = await countRows(db, scope, story, workflowId);

  const recorded = (
    await db
      .select({ tickKey: factoryWorkflowRuns.tickKey })
      .from(factoryWorkflowRuns)
      .where(
        and(
          eq(factoryWorkflowRuns.workflowId, workflowId),
          eq(factoryWorkflowRuns.orgId, scope.orgId),
          eq(factoryWorkflowRuns.factoryId, scope.factoryId),
          eq(factoryWorkflowRuns.startedBy, SEED_STARTER),
        ),
      )
  ).map((row) => row.tickKey);
  if (recorded.some((key) => !key.startsWith(prefix))) {
    const held = Object.keys(story.script.scenarios).filter((name) =>
      recorded.some((key) => key.startsWith(scenarioPrefix(name))),
    );
    throw new SeedStoryError(
      "scenario_conflict",
      `This workflow already holds a replay of ${held.map((name) => `"${name}"`).join(", ") || "another scenario"}. Pass purge: true first, then seed "${scenario}".`,
      { seededScenarios: held },
    );
  }
  const mine = recorded.filter((key) => expectedKeys.has(key));
  if (mine.length > 0 && mine.length < expectedKeys.size) {
    throw new SeedStoryError(
      "partial_replay",
      `An earlier replay of "${scenario}" stopped partway (${mine.length} of ${expectedKeys.size} ticks recorded). Pass purge: true first, then seed again.`,
      { recorded: mine.length, expected: expectedKeys.size },
    );
  }

  const ticks = { total: plan.size, ran: 0, reused: 0, crashed: 0 };
  if (mine.length === 0) {
    await replay({
      input,
      workflowId,
      version: workflow.version,
      start,
      steps,
      plan,
      ticks,
    });
  } else {
    ticks.reused = plan.size;
  }

  const after = await countRows(db, scope, story, workflowId);
  const runRows = await db
    .select({ id: factoryWorkflowRuns.id, status: factoryWorkflowRuns.status })
    .from(factoryWorkflowRuns)
    .where(
      and(
        eq(factoryWorkflowRuns.workflowId, workflowId),
        eq(factoryWorkflowRuns.orgId, scope.orgId),
        eq(factoryWorkflowRuns.factoryId, scope.factoryId),
        eq(factoryWorkflowRuns.startedBy, SEED_STARTER),
      ),
    )
    .limit(LISTED_IDS_MAX);
  const byStatus: Record<string, number> = {};
  const statuses = await db
    .select({ status: factoryWorkflowRuns.status, n: count() })
    .from(factoryWorkflowRuns)
    .where(
      and(
        eq(factoryWorkflowRuns.workflowId, workflowId),
        eq(factoryWorkflowRuns.orgId, scope.orgId),
        eq(factoryWorkflowRuns.factoryId, scope.factoryId),
        eq(factoryWorkflowRuns.startedBy, SEED_STARTER),
      ),
    )
    .groupBy(factoryWorkflowRuns.status);
  for (const row of statuses) byStatus[row.status] = row.n;
  const itemRows = await db
    .select({ id: triageItems.id })
    .from(triageItems)
    .where(seededItems(scope, story))
    .limit(LISTED_IDS_MAX);
  const [parked] = await db
    .select({ n: count() })
    .from(factoryWorkflowItemState)
    .where(
      and(
        eq(factoryWorkflowItemState.workflowId, workflowId),
        eq(factoryWorkflowItemState.orgId, scope.orgId),
        eq(factoryWorkflowItemState.factoryId, scope.factoryId),
        sql`${factoryWorkflowItemState.parkedAtNode} is not null`,
      ),
    );

  return {
    storyId: story.folder,
    scenario,
    workflowId,
    workflowName,
    created: {
      workflow: createdWorkflow,
      runs: after.runs - before.runs,
      items: after.items - before.items,
    },
    reused: {
      workflow: !createdWorkflow,
      runs: before.runs,
      items: before.items,
    },
    ticks,
    runs: {
      total: after.runs,
      ids: runRows.map((row) => row.id),
      byStatus,
    },
    items: {
      total: after.items,
      ids: itemRows.map((row) => row.id),
      parked: parked?.n ?? 0,
    },
  };
}

async function replay(args: {
  input: SeedStoryInput;
  workflowId: string;
  version: number;
  start: string;
  steps: readonly StoryStep[];
  plan: Map<StoryStep, PlannedTick>;
  ticks: SeedStoryResult["ticks"];
}): Promise<void> {
  const { input, workflowId, version, plan, ticks } = args;
  const { scope, story, getDatabase } = input;
  const db = getDatabase();
  const test = makeHost({
    catalog: OPERATION_CATALOG,
    scope,
    start: args.start,
  });
  const clock = () => test.clock.now();
  const store = createDrizzleWorkflowStore({ getDatabase, clock });
  const items = markingItemWriter(
    db,
    scope,
    story,
    createItemsHost({
      scope,
      ownerEmail: input.ownerEmail,
      getDatabase,
      clock,
    }),
  );
  const host: WorkflowHost = {
    ...test.host,
    store,
    items,
    inbox: storingInbox(test.inbox, items),
  };
  const world: StoryWorld = { test, store: () => store };

  // The engine runs a live tick only on an enabled workflow, and enabling asks
  // for a clean dry run no replay can honestly produce. Only the rows are
  // switched: the job file stays off, so the scheduler never fires it, and the
  // rows go back off when the replay ends.
  const lookup = createDrizzleWorkflowStore({ getDatabase });
  await lookup.recordCleanDryRun(scope, { workflowId, version });
  await lookup.setWorkflowEnabled(scope, workflowId, true);
  let tickNumber = 0;
  try {
    for (const step of args.steps) {
      switch (step.kind) {
        case "clock":
          test.clock.set(step.at);
          break;
        case "provider":
          for (const answer of step.answers ?? []) {
            test.operations.script(step.operation, answer);
          }
          if (step.thenAlways) {
            test.operations.always(step.operation, step.thenAlways);
          }
          break;
        case "inbox":
          for (const result of step.results ?? []) {
            test.inbox.script(step.source, result);
          }
          if (step.thenAlways) test.inbox.always(step.source, step.thenAlways);
          break;
        case "ai":
          for (const answer of step.answers ?? []) test.ai.respond(answer);
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
          await store.leaseItems(scope, {
            workflowId,
            graphVersion: version,
            itemIds: step.itemIds,
            leasedBy: "dead-tick",
            now: clock().toISOString(),
          });
          break;
        case "restart":
          // The rows are already in the database, which is all a restart keeps.
          break;
        case "tick": {
          tickNumber += 1;
          const planned = plan.get(step);
          if (!planned) {
            throw new SeedStoryError(
              "replay_failed",
              `Tick ${tickNumber} was not planned.`,
            );
          }
          test.clock.set(planned.at);
          const mode = step.mode ?? "live";
          try {
            const result = await runTick({
              host,
              scope,
              workflowId,
              tickKey: planned.key,
              mode,
              triggerKind: starterFor(mode),
              startedBy: SEED_STARTER,
              ...(step.testNodeId === undefined
                ? {}
                : { testNodeId: step.testNodeId }),
              ...(step.sampleItems === undefined
                ? {}
                : { sampleItems: step.sampleItems }),
            });
            if (result.kind === "duplicate_tick") ticks.reused += 1;
            else if (result.kind === "ran") ticks.ran += 1;
            else {
              throw new SeedStoryError(
                "replay_failed",
                `Tick ${tickNumber}${step.label ? ` ("${step.label}")` : ""} did not run: ${result.kind === "not_runnable" ? result.message : result.kind}`,
                { tick: tickNumber },
              );
            }
          } catch (error) {
            if (error instanceof SimulatedCrash) {
              ticks.crashed += 1;
              break;
            }
            if (error instanceof SeedStoryError) throw error;
            throw new SeedStoryError(
              "replay_failed",
              `Tick ${tickNumber}${step.label ? ` ("${step.label}")` : ""} failed: ${failureText(error)}`,
              { tick: tickNumber },
            );
          }
          break;
        }
        default: {
          const unhandled: never = step;
          throw new SeedStoryError(
            "replay_failed",
            `The replay does not know the script step ${JSON.stringify(unhandled).slice(0, 80)}.`,
          );
        }
      }
    }
  } finally {
    await lookup.setWorkflowEnabled(scope, workflowId, false);
  }
}

export async function purgeStory(
  input: PurgeStoryInput,
): Promise<PurgeStoryResult> {
  const { scope, story, getDatabase } = input;
  const db = getDatabase();
  const lookup = createDrizzleWorkflowStore({ getDatabase });
  const { seeded } = await findSeeded(db, lookup, scope, story);

  const purged: PurgeStoryResult["purged"] = {
    workflows: 0,
    runs: 0,
    steps: 0,
    itemEvents: 0,
    receipts: 0,
    itemStates: 0,
    items: 0,
  };
  if (seeded.length > 0) {
    const tables = [
      ["runs", factoryWorkflowRuns],
      ["steps", factoryWorkflowSteps],
      ["itemEvents", factoryWorkflowItemEvents],
      ["receipts", factoryWorkflowReceipts],
      ["itemStates", factoryWorkflowItemState],
    ] as const;
    for (const [label, table] of tables) {
      const [row] = await db
        .select({ n: count() })
        .from(table)
        .where(
          and(
            inArray(table.workflowId, seeded),
            eq(table.orgId, scope.orgId),
            eq(table.factoryId, scope.factoryId),
          ),
        );
      purged[label] = row?.n ?? 0;
    }
    for (const workflowId of seeded) {
      await input.deleteWorkflow(workflowId);
      purged.workflows += 1;
    }
  }
  const removed = await db
    .delete(triageItems)
    .where(seededItems(scope, story))
    .returning({ id: triageItems.id });
  purged.items = removed.length;
  return { storyId: story.folder, purged };
}
