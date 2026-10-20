import { randomUUID } from "node:crypto";

import {
  loadActionsFromStaticRegistry,
  type ActionEntry,
} from "@agent-native/core/server";

import { resolveFactorySlackWorkspace } from "../connectors/slack-workflow.js";
import { getDb } from "../db/index.js";
import {
  createRunObserver,
  withRunObserver,
} from "../lib/workflow-run-observer.js";
import { createSlackWorkflowClient } from "../triage/slack-client.js";
import { createTripwireSink, type TripwireSink } from "../tripwire/index.js";
import type {
  AiTurnRunner,
  Clock,
  IdSource,
  OperationExecutor,
  ThreadReader,
  WorkflowHost,
  WorkflowScope,
  WorkflowStore,
} from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { RunMode, WorkflowSettings } from "../workflow/contract.js";
import { createAiTurnRunner } from "./ai-turn-runner.js";
import { getWorkflowStore } from "./factory-store.js";
import {
  createGuardedActionCaller,
  createInboxHost,
  type GuardedActionCaller,
} from "./inbox.js";
import {
  createItemsHost,
  keepStoredItemIds,
  type ItemsDatabase,
} from "./items.js";
import { createOperationExecutor } from "./operation-executor.js";
import { createThreadReader, type MemberLookup } from "./thread-reader.js";

/** What a test swaps out. Production passes none of it. */
export interface FactoryWorkflowHostDeps {
  store?: WorkflowStore;
  getDatabase?: () => ItemsDatabase;
  /** Factory's action registry; read from the generated registry on first use. */
  actions?: () => Promise<Record<string, ActionEntry>>;
  operations?: OperationExecutor;
  ai?: AiTurnRunner;
  threads?: ThreadReader;
  lookupMember?: (email: string, signal: AbortSignal) => Promise<MemberLookup>;
  clock?: Clock;
  ids?: IdSource;
  tripwire?: TripwireSink;
}

export interface FactoryWorkflowHostInput {
  scope: WorkflowScope;
  /** The job owner's email: the identity every call runs as. */
  ownerEmail: string;
  workflow: { id: string };
  /** What `requireFactoryAutomation` reads off each call to find the saved graph. */
  automation: { triggerId: string; triggerName: string; policyId?: string };
  /** The scheduler's id for this tick: the lineage on every guarded call. */
  runId: string;
  /**
   * The scheduler's history row for this tick. When set, the run the engine
   * starts records it, so a queued run in the scheduler's list can be matched
   * to its workflow run.
   */
  historyRowId?: string;
  mode: RunMode;
  /** Aborts at the hard deadline. */
  signal: AbortSignal;
  /** Epoch ms the host wants the run to stop taking work. */
  deadlineAt: number;
  /** Epoch ms the scheduler abandons the run: how long a tick may stay running before the next one calls it dead. */
  hardDeadlineAt?: number;
  settings: WorkflowSettings;
  deps?: FactoryWorkflowHostDeps;
}

const systemClock: Clock = {
  now: () => new Date(),
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  },
};

const randomIds: IdSource = { next: (kind) => `${kind}-${randomUUID()}` };

let registryLoad: Promise<Record<string, ActionEntry>> | undefined;

function loadFactoryActions(): Promise<Record<string, ActionEntry>> {
  registryLoad ??= import("../../.generated/actions-registry.js").then(
    (module) => loadActionsFromStaticRegistry(module.default),
    (error: unknown) => {
      registryLoad = undefined;
      throw error;
    },
  );
  return registryLoad;
}

/**
 * Finds who a reply Wait's people are in Slack. This is a read-only lookup the
 * reply Wait itself needs, run as the job owner against the workspace the job
 * reads; no action exposes it, and the gate has no node to name it by.
 */
function createSlackMemberLookup(input: {
  ownerEmail: string;
  scope: WorkflowScope;
  automation: FactoryWorkflowHostInput["automation"];
}): (email: string, signal: AbortSignal) => Promise<MemberLookup> {
  const identity = { userEmail: input.ownerEmail, orgId: input.scope.orgId };
  const client = createSlackWorkflowClient({
    ownerEmail: input.ownerEmail,
    orgId: input.scope.orgId,
  });
  let workspace: ReturnType<typeof resolveFactorySlackWorkspace> | undefined;
  return async (email, signal) => {
    signal.throwIfAborted();
    workspace ??= resolveFactorySlackWorkspace(
      { caller: "automation", automation: input.automation },
      identity,
      input.scope.factoryId,
    );
    let resolved;
    try {
      resolved = await workspace;
    } catch (error) {
      workspace = undefined;
      throw error;
    }
    const found = await client.findUserByEmail(resolved, email);
    if (!found) return { found: false, reason: "no_such_member" };
    if (found.deleted) return { found: false, reason: "deactivated" };
    if (found.isBot) return { found: false, reason: "bot" };
    return { found: true, id: found.id };
  };
}

/**
 * The executor the engine calls. A source's items keep the id a row of this
 * factory already holds (`keepStoredItemIds`). The AI runner gets the plain
 * executor: it never takes a source.
 */
function withStoredItemIds(
  operations: OperationExecutor,
  scope: WorkflowScope,
  getDatabase: () => ItemsDatabase,
): OperationExecutor {
  return {
    async execute(request) {
      const result = await operations.execute(request);
      if (!result.ok || result.items === undefined) return result;
      return {
        ...result,
        items: await keepStoredItemIds(
          getDatabase(),
          scope,
          request.operation.id,
          result.items,
        ),
      };
    },
  };
}

/**
 * Everything a tick calls besides the engine itself, wired the way Factory runs
 * it: the Drizzle store, the code catalog, provider and action calls through
 * core's guarded tool path as the job owner, the inbox and its items, the AI
 * turn runner, and Slack for reply Waits.
 *
 * The per-run model-call budget is not built here. The engine makes one from
 * the graph's `modelCallCap` and hands it to the AI runner with each request,
 * so a second one in the host could only disagree with it.
 */
export function createFactoryWorkflowHost(
  input: FactoryWorkflowHostInput,
): WorkflowHost {
  const { scope, ownerEmail, automation, runId, settings } = input;
  const deps = input.deps ?? {};
  const clock = deps.clock ?? systemClock;
  const getDatabase = deps.getDatabase ?? (() => getDb());
  const loadActions = deps.actions ?? loadFactoryActions;
  const baseStore = deps.store ?? getWorkflowStore();
  const store: WorkflowStore =
    input.historyRowId === undefined
      ? baseStore
      : {
          ...baseStore,
          startRun: (runScope, run) =>
            baseStore.startRun(runScope, {
              ...run,
              historyRowId: run.historyRowId ?? input.historyRowId,
            }),
        };

  // One sink for the host and for whatever the host builds, so a boundary
  // outside the engine records into the same factory and workflow.
  const tripwire: TripwireSink =
    deps.tripwire ??
    createTripwireSink({ scope, workflowId: input.workflow.id });

  // The calls below run inside it, so an action or connector they reach
  // reports to this workflow's tripwires too.
  const observer = createRunObserver(tripwire);

  const callAction: GuardedActionCaller = async (call) =>
    withRunObserver(observer, async () =>
      createGuardedActionCaller({
        actions: await loadActions(),
        ownerEmail,
        orgId: scope.orgId,
        automation,
        runId,
      })(call),
    );

  const operations =
    deps.operations ??
    createOperationExecutor({
      owner: ownerEmail,
      orgId: scope.orgId,
      factoryId: scope.factoryId,
      automation,
      runId,
      signal: input.signal,
      settings,
      observer,
      deps: { actions: loadActions },
    });

  return {
    store,
    catalog: OPERATION_CATALOG,
    operations:
      deps.operations ?? withStoredItemIds(operations, scope, getDatabase),
    inbox: createInboxHost({
      scope,
      workflowId: input.workflow.id,
      getDatabase,
      callAction,
      clock: () => clock.now(),
      tripwire,
    }),
    items: createItemsHost({
      scope,
      ownerEmail,
      getDatabase,
      clock: () => clock.now(),
    }),
    ai:
      deps.ai ??
      createAiTurnRunner({
        owner: ownerEmail,
        orgId: scope.orgId,
        factoryId: scope.factoryId,
        workflowId: input.workflow.id,
        catalog: OPERATION_CATALOG,
        operations,
        mode: input.mode,
        deadlineAt: input.deadlineAt,
        tripwire,
      }),
    threads:
      deps.threads ??
      createThreadReader({
        callAction,
        factoryId: scope.factoryId,
        lookupMember:
          deps.lookupMember ??
          createSlackMemberLookup({ ownerEmail, scope, automation }),
        clock,
      }),
    clock,
    ids: deps.ids ?? randomIds,
    shouldStop: () => clock.now().getTime() >= input.deadlineAt,
    ...(input.hardDeadlineAt === undefined
      ? {}
      : { runTimeoutMs: input.hardDeadlineAt - clock.now().getTime() }),
    tripwire,
  };
}
