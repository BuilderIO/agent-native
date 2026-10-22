import type { WorkflowStore } from "../../workflow/adapter.js";
import { buildGraph } from "../../workflow/story-graphs.fixture.js";
import { createInMemoryWorkflowStore } from "../../workflow/testing/in-memory-store.js";

/**
 * Fakes for the specs of the workflow actions: a real in-memory workflow
 * store, an in-memory resource table that behaves like core's (a conditional
 * write only lands on the exact file it was computed from), and the action
 * helpers. Each spec wires them in with `vi.mock` factories that import this
 * module, so every module under test sees the same instances.
 */

export const ORG_ID = "org-1";
export const USER_EMAIL = "teammate@example.test";
export const FACTORY_ID = "support-triage";

export const actionModule = {
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options: Record<string, unknown> = {}): never => {
    throw Object.assign(new Error(message), {
      actionContractError: true,
      errorCode: "action_failed",
      statusCode: 400,
      ...options,
    });
  },
};

interface Row {
  id: string;
  owner: string;
  path: string;
  content: string;
  updatedAt: number;
}

let store: WorkflowStore = createInMemoryWorkflowStore();
let rows = new Map<string, Row>();
let nextId = 1;
let tick = 1;
let beforeConditionalWrite: ((path: string) => void) | undefined;
const removedRunHistory: { owner: string; automation: string }[] = [];
const knownFactories = new Set<string>([FACTORY_ID]);

const keyOf = (owner: string, path: string) => `${owner}\u0000${path}`;

/** A new, empty world for the next test. */
export function reset(): void {
  store = createInMemoryWorkflowStore();
  rows = new Map();
  nextId = 1;
  tick = 1;
  beforeConditionalWrite = undefined;
  removedRunHistory.length = 0;
  knownFactories.clear();
  knownFactories.add(FACTORY_ID);
}

export const currentStore = (): WorkflowStore => store;
export const removedHistories = removedRunHistory;

export const workflowStoreModule = {
  getWorkflowStore: (): WorkflowStore => store,
};

export const memberModule = {
  requireWorkspaceMember: async () => ({
    userEmail: USER_EMAIL,
    orgId: ORG_ID,
    role: "member",
  }),
  workspaceMemberIdentityFromContext: () => ({
    userEmail: USER_EMAIL,
    orgId: ORG_ID,
  }),
};

export const factoryDefinitionsModule = {
  readFactoryDefinition: async (_orgId: string, factoryId: string) =>
    knownFactories.has(factoryId) ? { id: factoryId } : undefined,
};

const organizationResourceOwner = (orgId: string) =>
  `__organization__:${encodeURIComponent(orgId)}`;

const asResource = (row: Row) => ({
  ...row,
  mimeType: "text/markdown",
  size: row.content.length,
  createdAt: 0,
  createdBy: "system",
  visibility: "workspace",
  threadId: null,
  runId: null,
  expiresAt: null,
  metadata: null,
});

function put(owner: string, path: string, content: string): Row {
  const existing = rows.get(keyOf(owner, path));
  const row: Row = {
    id: existing?.id ?? `resource-${nextId++}`,
    owner,
    path,
    content,
    updatedAt: tick++,
  };
  rows.set(keyOf(owner, path), row);
  return row;
}

export const resourcesModule = {
  organizationResourceOwner,
  resourceGetByPath: async (owner: string, path: string) => {
    const row = rows.get(keyOf(owner, path));
    return row ? asResource(row) : null;
  },
  resourcePutIfAbsent: async (owner: string, path: string, content: string) => {
    if (rows.has(keyOf(owner, path))) return null;
    return asResource(put(owner, path, content));
  },
  resourcePutIfCurrent: async (input: {
    owner: string;
    path: string;
    content: string;
    expectedId: string;
    expectedUpdatedAt: number;
    expectedContent: string;
  }) => {
    beforeConditionalWrite?.(input.path);
    const row = rows.get(keyOf(input.owner, input.path));
    if (
      !row ||
      row.id !== input.expectedId ||
      row.updatedAt !== input.expectedUpdatedAt ||
      row.content !== input.expectedContent
    ) {
      return null;
    }
    return asResource(put(input.owner, input.path, input.content));
  },
  resourceDeleteByPath: async (owner: string, path: string) =>
    rows.delete(keyOf(owner, path)),
  resourceListContentByOwnersAndPrefixes: async (
    owners: readonly string[],
    prefixes: readonly string[],
  ) =>
    [...rows.values()]
      .filter(
        (row) =>
          owners.includes(row.owner) &&
          prefixes.some((prefix) => row.path.startsWith(prefix)),
      )
      .map(({ id, path, owner, content }) => ({ id, path, owner, content })),
};

/** Core's jobs module, with the run-history delete recorded instead of sent to a database. */
export function jobsModule(actual: Record<string, unknown>) {
  return {
    ...actual,
    deleteAutomationRuns: async (owner: string, automation: string) => {
      removedRunHistory.push({ owner, automation });
    },
  };
}

export function addFactory(factoryId: string): void {
  knownFactories.add(factoryId);
}

export const orgOwner = () => organizationResourceOwner(ORG_ID);

/** Every job file now in the fake table, as `[path, content]`. */
export function jobFiles(): [string, string][] {
  return [...rows.values()].map((row) => [row.path, row.content]);
}

export function readJob(path: string): string | undefined {
  return rows.get(keyOf(orgOwner(), path))?.content;
}

export function removeJob(path: string): void {
  rows.delete(keyOf(orgOwner(), path));
}

export function seedJob(path: string, content: string): string {
  return put(orgOwner(), path, content).id;
}

/** Simulates the scheduler writing run state between a read and a write. */
export function onConditionalWrite(
  edit: (content: string) => string,
  times = 1,
): void {
  let remaining = times;
  beforeConditionalWrite = (path) => {
    if (remaining <= 0) return;
    remaining -= 1;
    const row = rows.get(keyOf(orgOwner(), path));
    if (row) put(row.owner, row.path, edit(row.content));
  };
}

export const context = { userEmail: USER_EMAIL, caller: "frontend" } as const;
export const agentContext = { userEmail: USER_EMAIL, caller: "tool" } as const;

/** A graph that validates: a Trigger straight to an End. */
export function simpleGraph(
  trigger: Record<string, unknown> = { schedule: { every: "15m" } },
  settings: Record<string, unknown> = {},
) {
  return buildGraph({
    settings,
    nodes: [
      ["start", "trigger", trigger],
      ["finish", "end", { outcome: "done" }],
    ],
    edges: [["start", "out", "finish"]],
  });
}

/** Parses, but names an operation the catalog does not have. */
export function graphWithUnknownOperation() {
  return buildGraph({
    nodes: [
      ["start", "trigger", { schedule: { every: "15m" } }],
      ["notify", "action", { operation: "nope.missing", args: {} }],
      ["finish", "end", { outcome: "done" }],
    ],
    edges: [
      ["start", "out", "notify"],
      ["notify", "out", "finish"],
    ],
  });
}

interface TypedFailure extends Error {
  errorCode: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

/** The typed failure a call raises; the spec fails if it raises none. */
export async function failureOf(
  run: () => Promise<unknown>,
): Promise<TypedFailure> {
  try {
    await run();
  } catch (error) {
    return error as TypedFailure;
  }
  throw new Error("Expected the call to fail.");
}

type ActionRun = (
  input: Record<string, unknown>,
  context?: unknown,
) => Promise<any>;

/** The `run` of an action the specs loaded through the mocked `defineAction`. */
export function runOf(action: unknown): ActionRun {
  return (action as { run: ActionRun }).run;
}
