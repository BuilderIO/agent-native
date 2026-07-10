import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredAgentHarnessSession } from "./store.js";
import type {
  AgentHarnessAdapter,
  AgentHarnessEvent,
  AgentHarnessSession,
} from "./types.js";

const mocks = vi.hoisted(() => ({
  getByRunId: vi.fn(),
  update: vi.fn(),
  markStopped: vi.fn(),
  resolveAdapter: vi.fn(),
}));

vi.mock("./store.js", () => ({
  getAgentHarnessSessionByRunId: mocks.getByRunId,
  updateAgentHarnessSession: mocks.update,
  markAgentHarnessSessionStopped: mocks.markStopped,
}));

vi.mock("./registry.js", () => ({
  resolveAgentHarness: mocks.resolveAdapter,
}));

const {
  registerLiveAgentHarnessSession,
  resolveAgentHarnessApproval,
  sendAgentHarnessFollowUp,
  stopLiveAgentHarnessSession,
} = await import("./lifecycle.js");

describe("agent harness lifecycle", () => {
  let stored: StoredAgentHarnessSession;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = storedSession(`session-${Math.random()}`, `run-${Math.random()}`);
    mocks.getByRunId.mockImplementation(async () => stored);
    mocks.update.mockImplementation(async (_id, patch) => {
      stored = { ...stored, ...patch, updatedAt: Date.now() };
      return stored;
    });
  });

  it.each([
    [true, "approves"],
    [false, "denies"],
  ])("%s pending work when it %s a live approval", async (approved) => {
    const session = fakeSession();
    stored.pendingApproval = approvalEvent("approval-1");
    register(stored, session);

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-1", approved },
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(session.approve).toHaveBeenCalledWith({
      id: "approval-1",
      approved,
    });
    expect(stored.pendingApproval).toBeNull();
    expect(stored.resolvedApprovalIds).toContain("approval-1");
  });

  it("runs a follow-up through a live session and persists detached state", async () => {
    const session = fakeSession([{ type: "text-delta", text: "done" }]);
    register(stored, session);

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: " next task ",
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(session.streamTurn).toHaveBeenCalledWith({
      prompt: "next task",
      metadata: undefined,
    });
    expect(stored.resumeState).toEqual({ token: "next" });
  });

  it("allows a live approval to unblock an active follow-up", async () => {
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      yield approvalEvent("approval-live");
      await blocked;
      yield { type: "done" } as AgentHarnessEvent;
    });
    session.approve.mockImplementation(async () => unblock());
    register(stored, session);

    const followUp = sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "needs permission",
      scope: ownerScope(),
    });
    await vi.waitFor(() => {
      expect((stored.pendingApproval as { id?: string })?.id).toBe(
        "approval-live",
      );
    });
    const resolution = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-live", approved: true },
      scope: ownerScope(),
    });

    expect(resolution.ok).toBe(true);
    await expect(followUp).resolves.toMatchObject({ ok: true });
    expect(stored.pendingApproval).toBeNull();
  });

  it("rehydrates a resumable adapter for a follow-up after restart", async () => {
    stored.resumeState = { token: "saved" };
    const session = fakeSession([{ type: "done" }]);
    const adapter = fakeAdapter(session);
    mocks.resolveAdapter.mockReturnValue(adapter);

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "resume",
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(result.rehydrated).toBe(true);
    expect(adapter.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: stored.id,
        resumeState: { token: "saved" },
        ownerEmail: "owner@example.com",
      }),
    );
  });

  it("reports approval unavailable when the live callback was lost", async () => {
    stored.pendingApproval = approvalEvent("approval-lost");
    stored.resumeState = { token: "saved" };

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-lost", approved: true },
      scope: ownerScope(),
    });

    expect(result).toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(mocks.resolveAdapter).not.toHaveBeenCalled();
  });

  it("fails closed on owner mismatch", async () => {
    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "no access",
      scope: { ownerEmail: "mallory@example.com" },
    });

    expect(result).toMatchObject({ ok: false, errorCode: "owner_mismatch" });
  });

  it("treats a repeated resolution for the same approval as idempotent", async () => {
    stored.pendingApproval = null;
    stored.resolvedApprovalIds = ["approval-1"];

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-1", approved: true },
      scope: ownerScope(),
    });

    expect(result).toMatchObject({ ok: true, idempotent: true });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("stops and removes a live session", async () => {
    const session = fakeSession();
    register(stored, session);

    await expect(
      stopLiveAgentHarnessSession({
        sessionId: stored.id,
        scope: ownerScope(),
      }),
    ).resolves.toBe(true);
    await expect(
      stopLiveAgentHarnessSession({
        sessionId: stored.id,
        scope: ownerScope(),
      }),
    ).resolves.toBe(false);
    expect(session.stop).toHaveBeenCalledOnce();
  });
});

function storedSession(id: string, runId: string): StoredAgentHarnessSession {
  return {
    id,
    runId,
    harnessName: "fake",
    threadId: "thread-1",
    providerSessionId: "native-1",
    status: "idle",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    resolvedApprovalIds: [],
  };
}

function ownerScope() {
  return { ownerEmail: "owner@example.com", orgId: "org-1" };
}

function approvalEvent(id: string): AgentHarnessEvent {
  return { type: "approval-request", id, message: "Allow tool?" };
}

function register(
  stored: StoredAgentHarnessSession,
  session: AgentHarnessSession,
): void {
  registerLiveAgentHarnessSession({
    sessionId: stored.id,
    adapter: fakeAdapter(session),
    session,
    ownerEmail: stored.ownerEmail,
    orgId: stored.orgId,
  });
}

function fakeAdapter(session: AgentHarnessSession): AgentHarnessAdapter {
  return {
    name: "fake",
    label: "Fake",
    description: "Fake adapter",
    capabilities: {
      sandbox: false,
      resumable: true,
      approvals: true,
      hostTools: false,
      fileEvents: false,
    },
    createSession: vi.fn(async () => session),
  };
}

function fakeSession(events: AgentHarnessEvent[] = []): AgentHarnessSession & {
  streamTurn: ReturnType<typeof vi.fn>;
  approve: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  return {
    id: `native-${Math.random()}`,
    streamTurn: vi.fn(async function* () {
      for (const event of events) yield event;
    }),
    approve: vi.fn(async () => undefined),
    detach: vi.fn(async () => ({ token: "next" })),
    stop: vi.fn(async () => undefined),
  };
}
