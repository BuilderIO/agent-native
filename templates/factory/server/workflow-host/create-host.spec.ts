import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  executor: vi.fn(),
  ai: vi.fn(),
  inbox: vi.fn(),
  items: vi.fn(),
  guarded: vi.fn(),
  threads: vi.fn(),
  workspace: vi.fn(),
  findUserByEmail: vi.fn(),
  slackClient: vi.fn(),
  tripwireSink: vi.fn(),
}));

vi.mock("./operation-executor.js", () => ({
  createOperationExecutor: (options: unknown) => {
    captured.executor(options);
    return { marker: "executor" };
  },
}));
vi.mock("./ai-turn-runner.js", () => ({
  createAiTurnRunner: (options: unknown) => {
    captured.ai(options);
    return { marker: "ai" };
  },
}));
vi.mock("./inbox.js", () => ({
  createInboxHost: (options: unknown) => {
    captured.inbox(options);
    return { marker: "inbox" };
  },
  createGuardedActionCaller: (options: unknown) => {
    captured.guarded(options);
    return async () => ({ status: "completed", output: "{}" });
  },
}));
vi.mock("./items.js", () => ({
  createItemsHost: (options: unknown) => {
    captured.items(options);
    return { marker: "items" };
  },
}));
vi.mock("./thread-reader.js", () => ({
  createThreadReader: (options: unknown) => {
    captured.threads(options);
    return { marker: "threads" };
  },
}));
vi.mock("../connectors/slack-workflow.js", () => ({
  resolveFactorySlackWorkspace: captured.workspace,
}));
vi.mock("../triage/slack-client.js", () => ({
  createSlackWorkflowClient: (identity: unknown) => {
    captured.slackClient(identity);
    return { findUserByEmail: captured.findUserByEmail };
  },
}));
vi.mock("../tripwire/index.js", () => ({
  createTripwireSink: (base: unknown) => {
    captured.tripwireSink(base);
    return Object.assign(() => undefined, { marker: "tripwire" });
  },
}));
vi.mock("./factory-store.js", () => ({
  getWorkflowStore: () => {
    throw new Error("the production store must not be read in this spec");
  },
}));
vi.mock("../db/index.js", () => ({
  getDb: () => {
    throw new Error("the production database must not be read in this spec");
  },
}));

import type { WorkflowStore } from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import { workflowSettingsSchema } from "../workflow/contract.js";
import { FakeClock } from "../workflow/testing/fakes.js";
import { createInMemoryWorkflowStore } from "../workflow/testing/in-memory-store.js";
import {
  createFactoryWorkflowHost,
  type FactoryWorkflowHostInput,
} from "./create-host.js";

const SCOPE = { orgId: "org-1", factoryId: "support-triage" };
const AUTOMATION = {
  triggerId: "resource-1",
  triggerName: "factories/support-triage/workflow-x",
  policyId: "policy-1",
};
const T0 = "2026-10-19T12:00:00.000Z";

let clock: FakeClock;
let store: WorkflowStore;
let loadActions: ReturnType<typeof vi.fn>;
const database = { marker: "database" };

function input(
  overrides: Partial<FactoryWorkflowHostInput> = {},
): FactoryWorkflowHostInput {
  return {
    scope: SCOPE,
    ownerEmail: "creator@example.test",
    workflow: { id: "wf-1" },
    automation: AUTOMATION,
    runId: "history-9",
    mode: "dry",
    signal: new AbortController().signal,
    deadlineAt: Date.parse(T0) + 60_000,
    settings: workflowSettingsSchema.parse({}),
    deps: {
      store,
      clock,
      getDatabase: () => database as never,
      actions: loadActions as never,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clock = new FakeClock(T0);
  store = createInMemoryWorkflowStore({ clock: () => clock.now() });
  loadActions = vi.fn(async () => ({}));
});

describe("createFactoryWorkflowHost", () => {
  it("assembles every part a tick calls out to, over the code catalog", () => {
    const host = createFactoryWorkflowHost(input());

    expect(host).toMatchObject({
      store,
      catalog: OPERATION_CATALOG,
      operations: { execute: expect.any(Function) },
      inbox: { marker: "inbox" },
      items: { marker: "items" },
      ai: { marker: "ai" },
      threads: { marker: "threads" },
      clock,
    });
    expect(host.ids.next("lease")).toMatch(/^lease-/);
    expect(host.ids.next("lease")).not.toBe(host.ids.next("lease"));
  });

  it("runs provider and action calls as the job owner, under the job's lineage and this tick's id", async () => {
    const signal = new AbortController().signal;
    createFactoryWorkflowHost(input({ signal }));

    expect(captured.executor).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "creator@example.test",
        orgId: "org-1",
        factoryId: "support-triage",
        automation: AUTOMATION,
        runId: "history-9",
        signal,
      }),
    );
    const inboxOptions = captured.inbox.mock.calls[0]?.[0];
    expect(inboxOptions).toMatchObject({
      scope: SCOPE,
      workflowId: "wf-1",
    });
    await inboxOptions.callAction({
      name: "poll-slack-channel",
      input: {},
      callId: "c1",
      signal,
    });
    expect(loadActions).toHaveBeenCalledTimes(1);
    expect(captured.guarded).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "creator@example.test",
        orgId: "org-1",
        automation: AUTOMATION,
        runId: "history-9",
      }),
    );
    // One loader serves the executor, the inbox and the thread reader.
    expect(captured.executor.mock.calls[0]?.[0].deps.actions).toBe(loadActions);
    expect(captured.items).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: SCOPE,
        ownerEmail: "creator@example.test",
      }),
    );
  });

  it("gives the AI runner the mode, the deadline, and the code catalog", () => {
    const deadlineAt = Date.parse(T0) + 90_000;
    createFactoryWorkflowHost(input({ mode: "test", deadlineAt }));

    expect(captured.ai).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "creator@example.test",
        orgId: "org-1",
        factoryId: "support-triage",
        workflowId: "wf-1",
        catalog: OPERATION_CATALOG,
        operations: { marker: "executor" },
        mode: "test",
        deadlineAt,
      }),
    );
  });

  it("stops taking work from the soft deadline on, by the host's clock", () => {
    const host = createFactoryWorkflowHost(
      input({ deadlineAt: Date.parse(T0) + 60_000 }),
    );

    expect(host.shouldStop()).toBe(false);
    clock.advance(59_999);
    expect(host.shouldStop()).toBe(false);
    clock.advance(1);
    expect(host.shouldStop()).toBe(true);
  });

  it("hands the workflow's settings to the executor, which reads Builder's project and stuck window from them", () => {
    const settings = workflowSettingsSchema.parse({
      builderProjectId: "workflow-project",
      builderStuckAfterMinutes: 45,
    });
    createFactoryWorkflowHost(input({ settings }));

    expect(captured.executor.mock.calls[0]?.[0].settings).toBe(settings);
    expect(captured.executor.mock.calls[0]?.[0].deps.builder).toBeUndefined();
  });

  it("leaves the model-call budget to the engine, which makes one per run from the graph's cap", () => {
    createFactoryWorkflowHost(input());

    expect(captured.ai.mock.calls[0]?.[0]).not.toHaveProperty("budget");
  });

  describe("recording the scheduler's run", () => {
    const startInput = {
      workflowId: "wf-1",
      tickKey: "tick-1",
      mode: "dry" as const,
      triggerKind: "dry_run" as const,
      startedBy: "teammate@example.test",
      graphVersion: 1,
    };

    async function started(historyRowId: string | undefined) {
      const workflow = await store.createWorkflow(SCOPE, {
        id: "wf-1",
        name: "Digest",
        ownerEmail: "creator@example.test",
        graph: {
          nodes: [],
          edges: [],
          settings: workflowSettingsSchema.parse({}),
        },
      });
      const host = createFactoryWorkflowHost(
        input({ ...(historyRowId ? { historyRowId } : {}) }),
      );
      return host.store.startRun(SCOPE, {
        ...startInput,
        workflowId: workflow.id,
      });
    }

    it("stores the history row on the run the engine starts, so one can be found from the other", async () => {
      const { run } = await started("history-9");
      expect(run.historyRowId).toBe("history-9");
    });

    it("hands the engine the store itself when there is no history row to record", async () => {
      const { run } = await started(undefined);
      expect(run.historyRowId).toBeUndefined();
      expect(createFactoryWorkflowHost(input()).store).toBe(store);
    });
  });

  describe("the Slack lookup a reply Wait needs", () => {
    function lookup() {
      createFactoryWorkflowHost(input());
      return captured.threads.mock.calls[0]?.[0] as {
        factoryId: string;
        lookupMember: (email: string, signal: AbortSignal) => Promise<unknown>;
      };
    }

    beforeEach(() => {
      captured.workspace.mockResolvedValue("secondary");
    });

    it("looks the person up in the workspace the job reads, as the job owner", async () => {
      captured.findUserByEmail.mockResolvedValue({
        id: "U1",
        isBot: false,
        deleted: false,
      });
      const reader = lookup();

      expect(reader.factoryId).toBe("support-triage");
      expect(
        await reader.lookupMember(
          "ana@example.test",
          new AbortController().signal,
        ),
      ).toEqual({ found: true, id: "U1" });

      expect(captured.slackClient).toHaveBeenCalledWith({
        ownerEmail: "creator@example.test",
        orgId: "org-1",
      });
      expect(captured.workspace).toHaveBeenCalledWith(
        { caller: "automation", automation: AUTOMATION },
        { userEmail: "creator@example.test", orgId: "org-1" },
        "support-triage",
      );
      expect(captured.findUserByEmail).toHaveBeenCalledWith(
        "secondary",
        "ana@example.test",
      );
    });

    it("tells apart nobody, a deactivated account and a bot, and works the workspace out once", async () => {
      const reader = lookup();
      const signal = new AbortController().signal;
      captured.findUserByEmail
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "U2", isBot: false, deleted: true })
        .mockResolvedValueOnce({ id: "U3", isBot: true, deleted: false });

      expect(await reader.lookupMember("a@example.test", signal)).toEqual({
        found: false,
        reason: "no_such_member",
      });
      expect(await reader.lookupMember("b@example.test", signal)).toEqual({
        found: false,
        reason: "deactivated",
      });
      expect(await reader.lookupMember("c@example.test", signal)).toEqual({
        found: false,
        reason: "bot",
      });
      expect(captured.workspace).toHaveBeenCalledTimes(1);
    });

    it("does not remember a workspace it failed to work out, and does not ask Slack once aborted", async () => {
      const reader = lookup();
      captured.workspace
        .mockRejectedValueOnce(new Error("job file unreadable"))
        .mockResolvedValue("primary");
      captured.findUserByEmail.mockResolvedValue(null);
      const signal = new AbortController().signal;

      await expect(
        reader.lookupMember("a@example.test", signal),
      ).rejects.toThrow("job file unreadable");
      await reader.lookupMember("a@example.test", signal);
      expect(captured.workspace).toHaveBeenCalledTimes(2);

      const aborted = new AbortController();
      aborted.abort(new Error("hard deadline"));
      captured.findUserByEmail.mockClear();
      await expect(
        reader.lookupMember("a@example.test", aborted.signal),
      ).rejects.toThrow("hard deadline");
      expect(captured.findUserByEmail).not.toHaveBeenCalled();
    });
  });

  it("binds the tripwire port to this factory and workflow", () => {
    createFactoryWorkflowHost(input());

    expect(captured.tripwireSink).toHaveBeenCalledWith({
      scope: SCOPE,
      workflowId: "wf-1",
    });
  });

  it("uses what a test hands it instead of building the real thing", () => {
    const operations = { execute: vi.fn() };
    const ai = { run: vi.fn() };
    const threads = { readReplies: vi.fn() };
    const ids = { next: () => "fixed" };

    const host = createFactoryWorkflowHost(
      input({
        deps: {
          store,
          clock,
          getDatabase: () => database as never,
          operations,
          ai,
          threads,
          ids,
        },
      }),
    );

    expect(host).toMatchObject({ operations, ai, threads, ids });
    expect(captured.executor).not.toHaveBeenCalled();
    expect(captured.ai).not.toHaveBeenCalled();
    expect(captured.threads).not.toHaveBeenCalled();
  });
});
