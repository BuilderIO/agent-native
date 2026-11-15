import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, unknown>>(),
  sources: new Map<string, string | null>(),
  abort: vi.fn(),
  events: vi.fn(async () => []),
  sessionEvents: vi.fn(async () => []),
  stop: vi.fn(),
  followUp: vi.fn(),
  approval: vi.fn(),
  list: vi.fn(),
}));

vi.mock("../run-manager.js", () => ({
  abortRunDurably: fixture.abort,
  getRun: vi.fn(),
}));
vi.mock("../run-store.js", () => ({
  getRunEventsSince: fixture.events,
  getRunById: vi.fn(),
}));
vi.mock("../../chat-threads/store.js", () => ({
  getThread: vi.fn(async (id: string) =>
    fixture.sources.has(id)
      ? { source: { appId: fixture.sources.get(id) } }
      : null,
  ),
  hasThreadAccess: vi.fn(),
}));
vi.mock("./lifecycle.js", () => ({
  resolveAgentHarnessApproval: fixture.approval,
  sendAgentHarnessFollowUp: fixture.followUp,
  stopAndPersistAgentHarnessSession: fixture.stop,
}));
vi.mock("./store.js", () => ({
  getAgentHarnessSessionByRunId: vi.fn(
    async (id: string) => fixture.sessions.get(id) ?? null,
  ),
  listAgentHarnessSessionEvents: fixture.sessionEvents,
  listAgentHarnessSessions: fixture.list,
}));

import { createAgentHarnessBackgroundAgentController } from "./background.js";

const scope = {
  ownerEmail: "owner@example.test",
  orgId: "org-a",
  sourceAppId: "app-a",
};

beforeEach(() => {
  vi.clearAllMocks();
  fixture.sessions.clear();
  fixture.sources.clear();
  for (const [id, appId, ownerEmail, orgId] of [
    ["local", "app-a", scope.ownerEmail, scope.orgId],
    ["foreign", "app-b", scope.ownerEmail, scope.orgId],
    ["legacy", null, scope.ownerEmail, scope.orgId],
    ["foreign-owner", "app-a", "other@example.test", scope.orgId],
    ["foreign-org", "app-a", scope.ownerEmail, "org-b"],
  ]) {
    fixture.sessions.set(String(id), {
      id: `session-${id}`,
      runId: id,
      threadId: `thread-${id}`,
      harnessName: "test",
      ownerEmail,
      orgId,
      status: "running",
      createdAt: 1,
      updatedAt: 2,
      pendingApproval: { id: `approval-${id}` },
    });
    fixture.sources.set(`thread-${id}`, appId);
  }
  fixture.list.mockImplementation(async () => [...fixture.sessions.values()]);
  fixture.events.mockResolvedValue([]);
  fixture.sessionEvents.mockResolvedValue([]);
  fixture.stop.mockImplementation(async ({ sessionId, status }) => ({
    ...[...fixture.sessions.values()].find(
      (session) => session.id === sessionId,
    ),
    status,
  }));
  fixture.followUp.mockResolvedValue({ ok: true });
  fixture.approval.mockResolvedValue({ ok: true });
});

it("passes trusted app scope into storage and returns only the proper same-app owner/org run", async () => {
  const controller = createAgentHarnessBackgroundAgentController(scope);
  expect((await controller.list()).map((run) => run.id)).toEqual(["local"]);
  expect(fixture.list).toHaveBeenCalledWith(scope);
});

it.each(["foreign", "legacy", "foreign-owner", "foreign-org", "missing"])(
  "denies %s across reads and controls before any mutation",
  async (runId) => {
    const controller = createAgentHarnessBackgroundAgentController(scope);
    expect(await controller.get(runId)).toBeNull();
    expect(await controller.transcript(runId)).toEqual([]);
    expect(await controller.control({ runId, command: "stop" })).toMatchObject({
      ok: false,
      run: null,
    });
    expect(
      await controller.sendFollowUp({ runId, prompt: "continue" }),
    ).toMatchObject({ ok: false, run: null });
    expect(
      await controller.control({ runId, command: "approve" }),
    ).toMatchObject({ ok: false, run: null });
    expect(await controller.control({ runId, command: "deny" })).toMatchObject({
      ok: false,
      run: null,
    });
    for (const operation of [
      fixture.abort,
      fixture.stop,
      fixture.followUp,
      fixture.approval,
      fixture.events,
      fixture.sessionEvents,
    ])
      expect(operation).not.toHaveBeenCalled();
  },
);

it.each([null, "", "   "])(
  "fails closed when the trusted app is %s",
  async (sourceAppId) => {
    const controller = createAgentHarnessBackgroundAgentController({
      ...scope,
      sourceAppId,
    });
    expect(await controller.list()).toEqual([]);
    expect(await controller.get("local")).toBeNull();
    expect(
      await controller.control({ runId: "local", command: "stop" }),
    ).toMatchObject({ ok: false });
    expect(fixture.abort).not.toHaveBeenCalled();
    expect(fixture.stop).not.toHaveBeenCalled();
  },
);

it("retains same-app get, transcript, stop, follow-up and approval", async () => {
  const controller = createAgentHarnessBackgroundAgentController(scope);
  expect(await controller.get("local")).toMatchObject({ id: "local" });
  expect(await controller.transcript("local")).toEqual([]);
  expect(fixture.events).toHaveBeenCalledWith("local", 0);
  expect(
    await controller.sendFollowUp({ runId: "local", prompt: "continue" }),
  ).toMatchObject({ ok: true });
  expect(fixture.followUp).toHaveBeenCalledWith(
    expect.objectContaining({ runId: "local", scope }),
  );
  expect(
    await controller.control({ runId: "local", command: "approve" }),
  ).toMatchObject({ ok: true });
  expect(fixture.approval).toHaveBeenCalledWith({
    runId: "local",
    approval: { id: "approval-local", approved: true },
    scope,
  });
  expect(
    await controller.control({ runId: "local", command: "stop" }),
  ).toMatchObject({ ok: true });
  expect(fixture.abort).toHaveBeenCalledWith("local", "user", {
    allowNotStarted: true,
  });
  expect(fixture.stop).toHaveBeenCalledWith({
    sessionId: "session-local",
    scope,
    status: "stopped",
  });
});

it("keeps an explicitly unscoped internal controller aggregate while retaining owner/org", async () => {
  const controller = createAgentHarnessBackgroundAgentController({
    ownerEmail: scope.ownerEmail,
    orgId: scope.orgId,
  });
  expect((await controller.list()).map((run) => run.id)).toEqual([
    "local",
    "foreign",
    "legacy",
  ]);
  expect(await controller.get("foreign")).toMatchObject({ id: "foreign" });
});
