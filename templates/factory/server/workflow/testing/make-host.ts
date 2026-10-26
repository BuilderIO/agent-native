import type {
  TripwireInput,
  WorkflowHost,
  WorkflowRecord,
  WorkflowScope,
  WorkflowStore,
} from "../adapter.js";
import type { WorkflowGraph } from "../contract.js";
import type { OperationCatalog } from "../operations.js";
import {
  FakeAiTurnRunner,
  FakeClock,
  FakeInbox,
  FakeItemStatusWriter,
  FakeOperationExecutor,
  FakeThreadReader,
  createIdSource,
} from "./fakes.js";
import {
  createInMemoryWorkflowStore,
  type InMemoryStoreState,
} from "./in-memory-store.js";
import { buildTestCatalog } from "./test-catalog.js";

export interface TestHost {
  host: WorkflowHost;
  scope: WorkflowScope;
  store: WorkflowStore;
  operations: FakeOperationExecutor;
  ai: FakeAiTurnRunner;
  inbox: FakeInbox;
  threads: FakeThreadReader;
  statuses: FakeItemStatusWriter;
  clock: FakeClock;
  /** Every tripwire the engine recorded through `host.tripwire`, in order. */
  tripwires: TripwireInput[];
  /** Makes `shouldStop` answer from this; the default never stops. */
  stopWhen(predicate: () => boolean): void;
}

/**
 * A `WorkflowHost` wired to the in-memory store and scripted fakes, with a
 * clock and ids that behave the same on every run.
 */
export function makeHost(
  options: {
    catalog?: OperationCatalog;
    scope?: WorkflowScope;
    start?: Date | string;
    /** The rows to run on, so a test can open a second store over the same database. */
    state?: InMemoryStoreState;
    /** How long the scheduler lets one tick run, as a host that knows says. */
    runTimeoutMs?: number;
  } = {},
): TestHost {
  const clock = new FakeClock(options.start);
  const store = createInMemoryWorkflowStore({
    clock: () => clock.now(),
    ...(options.state ? { state: options.state } : {}),
  });
  const operations = new FakeOperationExecutor();
  const ai = new FakeAiTurnRunner();
  const inbox = new FakeInbox();
  const threads = new FakeThreadReader();
  const ids = createIdSource();
  const statuses = new FakeItemStatusWriter();
  const tripwires: TripwireInput[] = [];
  let stop = (): boolean => false;
  const host: WorkflowHost = {
    store,
    catalog: options.catalog ?? buildTestCatalog(),
    operations,
    inbox,
    items: statuses,
    ai,
    threads,
    clock,
    ids,
    shouldStop: () => stop(),
    tripwire: (input) => void tripwires.push(input),
    ...(options.runTimeoutMs === undefined
      ? {}
      : { runTimeoutMs: options.runTimeoutMs }),
  };
  return {
    host,
    scope: options.scope ?? { orgId: "org-1", factoryId: "factory-1" },
    store,
    operations,
    ai,
    inbox,
    threads,
    statuses,
    clock,
    tripwires,
    stopWhen(predicate) {
      stop = predicate;
    },
  };
}

/** Saves a graph as a workflow, and by default enables it through the clean dry run the store asks for. */
export async function seedWorkflow(
  test: TestHost,
  graph: WorkflowGraph,
  options: { enabled?: boolean; id?: string } = {},
): Promise<WorkflowRecord> {
  const created = await test.store.createWorkflow(test.scope, {
    ...(options.id === undefined ? {} : { id: options.id }),
    name: "Test workflow",
    graph,
    ownerEmail: "owner@example.test",
  });
  if (options.enabled === false) return created;
  await test.store.recordCleanDryRun(test.scope, {
    workflowId: created.id,
    version: created.version,
  });
  await test.store.setWorkflowEnabled(test.scope, created.id, true);
  return { ...created, enabled: true };
}

/**
 * What a person does after a save switched an enabled workflow off: a clean
 * dry run of the version it made, then switching it on again.
 */
export async function reenable(
  test: TestHost,
  workflowId: string,
): Promise<void> {
  const current = await test.store.getWorkflow(test.scope, workflowId);
  if (!current) throw new Error(`Workflow "${workflowId}" is not there.`);
  await test.store.recordCleanDryRun(test.scope, {
    workflowId,
    version: current.version,
  });
  await test.store.setWorkflowEnabled(test.scope, workflowId, true);
}
