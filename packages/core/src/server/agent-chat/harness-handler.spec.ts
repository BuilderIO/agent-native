import { mockEvent } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentHarnessAdapter } from "../../agent/harness/types.js";

const mocks = vi.hoisted(() => ({
  registerBuiltins: vi.fn(),
  resolveAdapter: vi.fn(),
  getLatest: vi.fn(),
  startHarnessRun: vi.fn(),
  startApprovalRun: vi.fn(),
  resolveApproval: vi.fn(),
  getActive: vi.fn(),
  subscribe: vi.fn(),
  tryClaim: vi.fn(),
}));

vi.mock("../../agent/harness/index.js", () => ({
  registerBuiltinAgentHarnesses: mocks.registerBuiltins,
  resolveAgentHarness: mocks.resolveAdapter,
  getLatestAgentHarnessSessionForThread: mocks.getLatest,
  startAgentHarnessRun: mocks.startHarnessRun,
  startAgentHarnessApprovalRun: mocks.startApprovalRun,
  resolveAgentHarnessApproval: mocks.resolveApproval,
}));
vi.mock("../../agent/run-manager.js", () => ({
  getActiveRunForThread: mocks.getActive,
  subscribeToRun: mocks.subscribe,
}));
vi.mock("../../agent/run-store.js", () => ({
  tryClaimRunSlot: mocks.tryClaim,
}));

const {
  createAgentHarnessChatHandler,
  evaluateAgentChatHarnessGuard,
  resolveAgentChatHarnessAdapter,
} = await import("./harness-handler.js");

const adapter: AgentHarnessAdapter = {
  name: "fake",
  label: "Fake",
  description: "Fake harness",
  capabilities: {
    sandbox: false,
    resumable: true,
    approvals: true,
    hostTools: false,
    fileEvents: false,
  },
  createSession: vi.fn(),
};

const activeRun = {
  runId: "run-1",
  threadId: "thread-1",
  turnId: "turn-1",
  events: [],
  status: "running",
  subscribers: new Set(),
  abort: new AbortController(),
  startedAt: Date.now(),
};

describe("agent chat harness configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAdapter.mockReturnValue(adapter);
    mocks.getLatest.mockResolvedValue(null);
    mocks.getActive.mockReturnValue(null);
    mocks.resolveApproval.mockResolvedValue({ ok: true, runId: "prior-run" });
    mocks.tryClaim.mockResolvedValue({ claimed: true, activeRunId: null });
    mocks.startHarnessRun.mockReturnValue(activeRun);
    mocks.startApprovalRun.mockReturnValue(activeRun);
    mocks.subscribe.mockReturnValue({ stream: true });
  });

  it("accepts an adapter instance without resolving an engine", () => {
    expect(resolveAgentChatHarnessAdapter({ adapter }, vi.fn())).toBe(adapter);
  });

  it("resolves a registered adapter with its config", () => {
    const resolve = vi.fn(() => adapter);

    expect(
      resolveAgentChatHarnessAdapter(
        { adapter: { name: "fake", config: { mode: "test" } } },
        resolve,
      ),
    ).toBe(adapter);
    expect(resolve).toHaveBeenCalledWith("fake", { mode: "test" });
  });

  it("fails closed when the request guard denies access", async () => {
    const event = mockEvent(new Request("http://localhost/chat"));

    await expect(
      evaluateAgentChatHarnessGuard(
        {
          adapter,
          guard: async () => ({
            allowed: false,
            status: 403,
            error: "Local harness access denied",
          }),
        },
        event,
      ),
    ).resolves.toEqual({
      allowed: false,
      status: 403,
      error: "Local harness access denied",
    });
  });

  it("does not resolve or start a runtime after a guard denial", async () => {
    const handler = createAgentHarnessChatHandler({
      harness: { adapter: "fake", guard: () => false },
      resolveOwnerEmail: () => "owner@example.com",
    });
    const event = chatEvent({ message: "hello", threadId: "thread-1" });

    await expect(handler(event)).resolves.toEqual({
      error: "Agent harness access denied",
    });
    expect(mocks.resolveAdapter).not.toHaveBeenCalled();
    expect(mocks.startHarnessRun).not.toHaveBeenCalled();
  });

  it("starts a foreground harness run with scoped resume state and no replayed history", async () => {
    mocks.getLatest.mockResolvedValue({
      id: "session-1",
      runId: "prior-run",
      harnessName: "fake",
      threadId: "thread-1",
      providerSessionId: "native-1",
      status: "idle",
      resumeState: { cursor: "opaque" },
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      resolvedApprovalIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const onRunPrepared = vi.fn();
    const handler = createAgentHarnessChatHandler({
      harness: { adapter: "fake", permissionMode: "allow-reads" },
      resolveOwnerEmail: () => "owner@example.com",
      resolveOrgId: () => "org-1",
      systemPrompt: "Use app actions.",
      onRunPrepared,
    });
    const event = chatEvent({
      message: "new prompt",
      history: [{ role: "user", content: "must not replay" }],
      threadId: "thread-1",
      turnId: "turn-1",
    });

    await expect(handler(event)).resolves.toEqual({ stream: true });
    expect(mocks.getLatest).toHaveBeenCalledWith("thread-1", "fake", {
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    expect(mocks.startHarnessRun).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        turnId: "turn-1",
        adapter,
        input: {
          prompt: "new prompt",
          metadata: undefined,
        },
        createSession: expect.objectContaining({
          sessionId: "session-1",
          resumeState: { cursor: "opaque" },
          permissionMode: "allow-reads",
          instructions: "Use app actions.",
        }),
        ownerEmail: "owner@example.com",
        orgId: "org-1",
      }),
    );
    expect(onRunPrepared).toHaveBeenCalledOnce();
  });

  it("resolves a live pending approval without replacing its active run", async () => {
    mocks.getLatest.mockResolvedValue({
      id: "session-1",
      runId: "prior-run",
      harnessName: "fake",
      threadId: "thread-1",
      providerSessionId: "native-1",
      status: "running",
      pendingApproval: {
        type: "approval-request",
        id: "approval-live",
        message: "Allow?",
      },
      ownerEmail: "owner@example.com",
      orgId: null,
      resolvedApprovalIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    mocks.getActive.mockReturnValue({ ...activeRun, runId: "prior-run" });
    const handler = createAgentHarnessChatHandler({
      harness: { adapter: "fake" },
      resolveOwnerEmail: () => "owner@example.com",
    });

    await expect(
      handler(
        chatEvent({
          message: "",
          threadId: "thread-1",
          approvedToolCalls: ["approval-live"],
        }),
      ),
    ).resolves.toEqual({ stream: true });
    expect(mocks.resolveApproval).toHaveBeenCalledWith({
      runId: "prior-run",
      approval: { id: "approval-live", approved: true },
      scope: { ownerEmail: "owner@example.com", orgId: null },
    });
    expect(mocks.startApprovalRun).not.toHaveBeenCalled();
    expect(mocks.tryClaim).not.toHaveBeenCalled();
  });

  it("continues only the matching idle approval through a run-manager run", async () => {
    mocks.getLatest.mockResolvedValue({
      id: "session-1",
      runId: "prior-run",
      harnessName: "fake",
      threadId: "thread-1",
      providerSessionId: "native-1",
      status: "idle",
      pendingApproval: {
        type: "approval-request",
        id: "approval-1",
        message: "Allow?",
      },
      ownerEmail: "owner@example.com",
      orgId: null,
      resolvedApprovalIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const handler = createAgentHarnessChatHandler({
      harness: { adapter: "fake" },
      resolveOwnerEmail: () => "owner@example.com",
    });
    const event = chatEvent({
      message: "",
      threadId: "thread-1",
      approvedToolCalls: ["approval-1"],
    });

    await expect(handler(event)).resolves.toEqual({ stream: true });
    expect(mocks.startApprovalRun).toHaveBeenCalledWith(
      expect.objectContaining({
        harnessRunId: "prior-run",
        threadId: "thread-1",
        approval: { id: "approval-1", approved: true },
        scope: { ownerEmail: "owner@example.com", orgId: null },
      }),
    );
    expect(mocks.startHarnessRun).not.toHaveBeenCalled();
  });

  it("forces Plan mode onto read-only permissions and guarded action tools", async () => {
    const handler = createAgentHarnessChatHandler({
      harness: { adapter: "fake", permissionMode: "allow-all" },
      actions: {
        updateRecord: {
          tool: {
            description: "Update a record",
            parameters: { type: "object", properties: {} },
          },
          run: vi.fn(async () => "updated"),
        },
      },
      resolveOwnerEmail: () => "owner@example.com",
    });

    await expect(
      handler(chatEvent({ message: "plan this", mode: "plan" })),
    ).resolves.toEqual({ stream: true });
    const call = mocks.startHarnessRun.mock.calls.at(-1)?.[0];
    expect(call.createSession.permissionMode).toBe("allow-reads");
    expect(call.createSession.tools.updateRecord.description).toContain(
      "Plan mode blocked",
    );
  });

  it("rejects attachments before persisting or starting a harness run", async () => {
    const onRunPrepared = vi.fn();
    const handler = createAgentHarnessChatHandler({
      harness: { adapter: "fake" },
      resolveOwnerEmail: () => "owner@example.com",
      onRunPrepared,
    });

    await expect(
      handler(
        chatEvent({
          message: "read this",
          attachments: [
            { type: "text", name: "notes.txt", text: "private notes" },
          ],
        }),
      ),
    ).resolves.toEqual({
      error: "This agent harness does not support chat attachments",
    });
    expect(onRunPrepared).not.toHaveBeenCalled();
    expect(mocks.startHarnessRun).not.toHaveBeenCalled();
  });
});

function chatEvent(body: Record<string, unknown>) {
  return mockEvent(
    new Request("http://localhost/_agent-native/agent-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
