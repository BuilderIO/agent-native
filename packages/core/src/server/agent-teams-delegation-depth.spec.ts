import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── app_state (task records + thread reverse-lookup) ──────────────────────
const appState = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const requestContextState = vi.hoisted(() => ({
  active: false,
  orgId: undefined as string | undefined,
  allowedActionNames: undefined as readonly string[] | undefined,
}));

vi.mock("../application-state/script-helpers.js", () => ({
  readAppState: vi.fn(async (key: string) => appState.get(key) ?? null),
  writeAppState: vi.fn(async (key: string, value: Record<string, unknown>) => {
    appState.set(key, value);
  }),
  deleteAppState: vi.fn(async (key: string) => appState.delete(key)),
  listAppState: vi.fn(async (prefix: string) =>
    [...appState.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value })),
  ),
}));

// ── spawn-path collaborators (kept inert; we only assert the depth guard) ──
const createThreadMock = vi.hoisted(() =>
  vi.fn(async (_owner: string, opts: { title?: string; source?: unknown }) => ({
    id: `thread-${Math.random().toString(36).slice(2, 8)}`,
    title: opts?.title ?? "",
    source: opts?.source ?? null,
  })),
);
vi.mock("../chat-threads/store.js", () => ({
  createThread: createThreadMock,
  updateThreadData: vi.fn(async () => {}),
  getThread: vi.fn(async () => null),
}));

const enqueueAgentTeamRunMock = vi.fn(async () => {});
vi.mock("./agent-teams-run-queue.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-teams-run-queue.js")>();
  return { ...actual, enqueueAgentTeamRun: enqueueAgentTeamRunMock };
});

const fireInternalDispatchMock = vi.fn(async () => {});
vi.mock("./self-dispatch.js", () => ({
  fireInternalDispatch: fireInternalDispatchMock,
}));

const resolveOrgIdForEmailMock = vi.hoisted(() =>
  vi.fn(async () => "email-selected-org" as string | null),
);
vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: resolveOrgIdForEmailMock,
}));

vi.mock("../progress/registry.js", () => ({
  startRun: vi.fn(async () => ({})),
  updateRunProgress: vi.fn(async () => ({})),
  completeRun: vi.fn(async () => ({})),
}));

vi.mock("./request-context.js", () => ({
  getRequestOrgId: () => requestContextState.orgId,
  getRequestRunContext: () => ({
    allowedActionNames: requestContextState.allowedActionNames,
  }),
  getRequestUserEmail: () => "owner@example.com",
  hasRequestContext: () => requestContextState.active,
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

const OWNER = "owner@example.com";
// The first import loads the full agent runtime. On a saturated CI worker it
// can exceed Vitest's default 5s even though the spawn itself is immediate.
const FIRST_AGENT_TEAMS_IMPORT_TIMEOUT_MS = 15_000;

function baseSpawnOptions() {
  return {
    description: "do the thing",
    ownerEmail: OWNER,
    systemPrompt: "base",
    actions: {},
    engine: { name: "test", defaultModel: "m" } as any,
    model: "m",
    parentSend: () => {},
  };
}

describe("agent-teams delegation-depth guardrail", () => {
  beforeEach(() => {
    appState.clear();
    enqueueAgentTeamRunMock.mockClear();
    fireInternalDispatchMock.mockClear();
    createThreadMock.mockClear();
    resolveOrgIdForEmailMock.mockClear();
    resolveOrgIdForEmailMock.mockResolvedValue("email-selected-org");
    requestContextState.active = false;
    requestContextState.orgId = undefined;
    requestContextState.allowedActionNames = undefined;
    delete process.env.AGENT_NATIVE_MAX_SUBAGENT_DEPTH;
  });

  afterEach(() => {
    delete process.env.AGENT_NATIVE_MAX_SUBAGENT_DEPTH;
  });

  // (i) within-limit spawn still works ───────────────────────────────────────
  it(
    "allows a top-level spawn and records the child at depth 1",
    async () => {
      const { spawnTask } = await import("./agent-teams.js");

      const task = await spawnTask(baseSpawnOptions());

      expect(task.status).toBe("running");
      expect(task.delegationDepth).toBe(1);
      expect(enqueueAgentTeamRunMock).toHaveBeenCalledTimes(1);
      expect(fireInternalDispatchMock).toHaveBeenCalledTimes(1);
    },
    FIRST_AGENT_TEAMS_IMPORT_TIMEOUT_MS,
  );

  it("persists the exact spawned action surface for durable execution", async () => {
    const { spawnTask } = await import("./agent-teams.js");
    requestContextState.allowedActionNames = ["agent-teams"];

    await spawnTask({
      ...baseSpawnOptions(),
      actions: {
        allowed: {
          tool: { description: "Allowed", parameters: {} },
          run: async () => "ok",
        },
      },
    });

    expect(enqueueAgentTeamRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          allowedActionNames: ["allowed"],
        }),
      }),
    );
  });

  it("keeps unscoped durable tasks on their legacy action behavior", async () => {
    const { spawnTask } = await import("./agent-teams.js");

    await spawnTask({
      ...baseSpawnOptions(),
      actions: {
        reader: {
          tool: { description: "Reader", parameters: {} },
          run: async () => "ok",
        },
      },
    });

    expect(enqueueAgentTeamRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.not.objectContaining({
          allowedActionNames: expect.anything(),
        }),
      }),
    );
  });

  it("persists the active parent organization instead of resolving another membership by email", async () => {
    const { spawnTask } = await import("./agent-teams.js");
    requestContextState.active = true;
    requestContextState.orgId = "parent-org";

    await spawnTask(baseSpawnOptions());

    expect(enqueueAgentTeamRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "parent-org" }),
    );
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });

  it("preserves an explicitly org-less parent request", async () => {
    const { spawnTask } = await import("./agent-teams.js");
    requestContextState.active = true;
    requestContextState.orgId = undefined;

    await spawnTask(baseSpawnOptions());

    expect(enqueueAgentTeamRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: null }),
    );
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });

  it("scopes a spawned thread to the parent app", async () => {
    const { spawnTask } = await import("./agent-teams.js");

    await spawnTask({
      ...baseSpawnOptions(),
      parentSourceAppId: "calendar",
    });

    expect(createThreadMock).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({
        source: { appId: "calendar" },
      }),
    );
  });

  it("allows a depth-1 sub-agent to spawn a depth-2 sub-agent (still within MAX=2)", async () => {
    const { spawnTask } = await import("./agent-teams.js");

    const task = await spawnTask({
      ...baseSpawnOptions(),
      parentDelegationDepth: 1,
    });

    expect(task.delegationDepth).toBe(2);
    expect(enqueueAgentTeamRunMock).toHaveBeenCalledTimes(1);
  });

  // (ii) spawn at/over MAX is refused with the error result ───────────────────
  it("refuses a spawn that would exceed MAX with a clear error and no enqueue", async () => {
    const { spawnTask, SubagentDelegationDepthError } =
      await import("./agent-teams.js");

    // Parent already at depth 2 → child would be depth 3 > MAX (2).
    await expect(
      spawnTask({ ...baseSpawnOptions(), parentDelegationDepth: 2 }),
    ).rejects.toThrowError(
      /Delegation depth limit reached \(max 2\); cannot spawn another sub-agent\./,
    );

    try {
      await spawnTask({ ...baseSpawnOptions(), parentDelegationDepth: 2 });
      throw new Error("expected spawnTask to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(SubagentDelegationDepthError);
      expect(
        (err as InstanceType<typeof SubagentDelegationDepthError>).decision,
      ).toMatchObject({
        allowed: false,
        parentDepth: 2,
        childDepth: 3,
        maxDepth: 2,
      });
    }

    // Refused spawns must not touch the dispatch queue.
    expect(enqueueAgentTeamRunMock).not.toHaveBeenCalled();
    expect(fireInternalDispatchMock).not.toHaveBeenCalled();
    // No task record should have been persisted.
    expect([...appState.keys()].some((k) => k.startsWith("agent-task:"))).toBe(
      false,
    );
  });

  it("enforces the cap defensively from the ambient run depth (no tool-stripping needed)", async () => {
    const { spawnTask, _agentTeamsQueueForTests } =
      await import("./agent-teams.js");

    // Simulate running inside a depth-2 sub-agent's loop. A nested spawnTask
    // with NO explicit parentDelegationDepth must read depth 2 from the ambient
    // store and refuse.
    await expect(
      _agentTeamsQueueForTests.runWithDelegationDepth(2, async () => {
        expect(_agentTeamsQueueForTests.currentAmbientDelegationDepth()).toBe(
          2,
        );
        return spawnTask(baseSpawnOptions());
      }),
    ).rejects.toThrowError(/Delegation depth limit reached \(max 2\)/);

    expect(enqueueAgentTeamRunMock).not.toHaveBeenCalled();
  });

  // (iii) the env override changes the limit ─────────────────────────────────
  it("raises the cap when AGENT_NATIVE_MAX_SUBAGENT_DEPTH overrides the default", async () => {
    process.env.AGENT_NATIVE_MAX_SUBAGENT_DEPTH = "4";
    const { spawnTask } = await import("./agent-teams.js");

    // Parent at depth 3 → child depth 4 ≤ 4 now allowed.
    const task = await spawnTask({
      ...baseSpawnOptions(),
      parentDelegationDepth: 3,
    });
    expect(task.delegationDepth).toBe(4);
    expect(enqueueAgentTeamRunMock).toHaveBeenCalledTimes(1);
  });

  it("lowers the cap to 0 (no sub-agents) when the env override is 0", async () => {
    process.env.AGENT_NATIVE_MAX_SUBAGENT_DEPTH = "0";
    const { spawnTask } = await import("./agent-teams.js");

    // Even a top-level spawn (parent depth 0 → child depth 1 > 0) is refused.
    await expect(spawnTask(baseSpawnOptions())).rejects.toThrowError(
      /Delegation depth limit reached \(max 0\)/,
    );
    expect(enqueueAgentTeamRunMock).not.toHaveBeenCalled();
  });
});

describe("evaluateSubagentDepth", () => {
  it("permits children up to and including the cap, refuses beyond it", async () => {
    const { evaluateSubagentDepth } = await import("./agent-teams.js");
    const env = {} as Record<string, string | undefined>;

    expect(evaluateSubagentDepth(0, env)).toMatchObject({
      allowed: true,
      childDepth: 1,
      maxDepth: 2,
    });
    expect(evaluateSubagentDepth(1, env)).toMatchObject({
      allowed: true,
      childDepth: 2,
    });
    expect(evaluateSubagentDepth(2, env)).toMatchObject({
      allowed: false,
      childDepth: 3,
      error: expect.stringContaining("Delegation depth limit reached (max 2)"),
    });
  });

  it("reads the cap from the supplied env and clamps invalid values to the default", async () => {
    const { evaluateSubagentDepth } = await import("./agent-teams.js");

    expect(
      evaluateSubagentDepth(2, { AGENT_NATIVE_MAX_SUBAGENT_DEPTH: "3" })
        .allowed,
    ).toBe(true);
    // Invalid override → falls back to default (2), so depth-3 child is refused.
    expect(
      evaluateSubagentDepth(2, { AGENT_NATIVE_MAX_SUBAGENT_DEPTH: "abc" })
        .allowed,
    ).toBe(false);
    expect(
      evaluateSubagentDepth(2, { AGENT_NATIVE_MAX_SUBAGENT_DEPTH: "-5" })
        .allowed,
    ).toBe(false);
  });

  it("normalizes a fractional / negative parent depth before deciding", async () => {
    const { evaluateSubagentDepth } = await import("./agent-teams.js");
    const env = {} as Record<string, string | undefined>;

    expect(evaluateSubagentDepth(1.9, env)).toMatchObject({
      parentDepth: 1,
      childDepth: 2,
      allowed: true,
    });
    expect(evaluateSubagentDepth(-3, env)).toMatchObject({
      parentDepth: 0,
      childDepth: 1,
      allowed: true,
    });
  });
});
