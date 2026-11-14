import { beforeEach, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("../application-state/script-helpers.js", () => ({
  readAppState: vi.fn(async (key: string) => {
    const value = appState.get(key);
    return value == null ? null : structuredClone(value);
  }),
  writeAppState: vi.fn(async (key: string, value: Record<string, unknown>) => {
    appState.set(key, structuredClone(value));
  }),
  compareAndSetAppState: vi.fn(
    async (
      key: string,
      expectedValue: Record<string, unknown> | null,
      nextValue: Record<string, unknown> | null,
    ) => {
      const currentValue = appState.get(key) ?? null;
      if (JSON.stringify(currentValue) !== JSON.stringify(expectedValue)) {
        return false;
      }
      if (nextValue === null) appState.delete(key);
      else appState.set(key, structuredClone(nextValue));
      return true;
    },
  ),
  compareAndSetManyAppState: vi.fn(
    async (
      operations: Array<{
        key: string;
        expectedValue: Record<string, unknown> | null;
        nextValue: Record<string, unknown> | null;
      }>,
    ) => {
      if (
        operations.some((operation) => {
          const currentValue = appState.get(operation.key) ?? null;
          return (
            JSON.stringify(currentValue) !==
            JSON.stringify(operation.expectedValue)
          );
        })
      ) {
        return false;
      }
      for (const operation of operations) {
        if (operation.nextValue === null) appState.delete(operation.key);
        else appState.set(operation.key, structuredClone(operation.nextValue));
      }
      return true;
    },
  ),
  deleteAppState: vi.fn(async (key: string) => appState.delete(key)),
  listAppState: vi.fn(async (prefix: string) =>
    [...appState.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: structuredClone(value) })),
  ),
}));

const fixtures = vi.hoisted(() => ({
  sourceApps: new Map<string, string | null>(),
  dispatch: vi.fn(async () => null),
  abort: vi.fn(async () => true),
}));
vi.mock("../chat-threads/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chat-threads/store.js")>()),
  getThread: vi.fn(async (id: string) =>
    fixtures.sourceApps.has(id)
      ? { source: { appId: fixtures.sourceApps.get(id) } }
      : null,
  ),
}));
vi.mock("./agent-teams-run-queue.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-teams-run-queue.js")>()),
  getAgentTeamRunDispatchState: fixtures.dispatch,
}));
vi.mock("../agent/run-manager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent/run-manager.js")>()),
  abortRunDurably: fixtures.abort,
}));
vi.mock("./action-change.js", () => ({
  notifyActionChangeInBackground: vi.fn(),
}));

const { getTask, listTasks, sendToTask, stopAgentTeamBackgroundRun } =
  await import("./agent-teams.js");
const scope = {
  ownerEmail: "owner@example.test",
  orgId: "org-a",
  sourceAppId: "app-a",
};
beforeEach(() => {
  vi.clearAllMocks();
  appState.clear();
  fixtures.sourceApps.clear();
  fixtures.dispatch.mockResolvedValue(null);
  fixtures.abort.mockResolvedValue(true);
  for (const [id, appId, ownerEmail, orgId] of [
    ["local", "app-a", scope.ownerEmail, scope.orgId],
    ["foreign", "app-b", scope.ownerEmail, scope.orgId],
    ["legacy", null, scope.ownerEmail, scope.orgId],
    ["other-owner", "app-a", "other@example.test", scope.orgId],
    ["other-org", "app-a", scope.ownerEmail, "org-b"],
  ]) {
    appState.set(`agent-task:${id}`, {
      taskId: id,
      threadId: `thread-${id}`,
      ownerEmail,
      orgId,
      description: "test work",
      status: "running",
      preview: "",
      summary: "",
      currentStep: "",
      createdAt: Date.now(),
    });
    fixtures.sourceApps.set(`thread-${id}`, appId);
  }
});

it("filters local app, owner and organization before any read reconciliation", async () => {
  expect((await listTasks(scope)).map((task) => task.taskId)).toEqual([
    "local",
  ]);
  expect(fixtures.dispatch).toHaveBeenCalledTimes(1);
  expect(fixtures.dispatch).toHaveBeenCalledWith("local");
});

it.each(["foreign", "legacy", "other-owner", "other-org", "missing"])(
  "denies %s get, send and stop without reconciliation or mutation",
  async (id) => {
    const before = structuredClone([...appState.entries()]);
    expect(await getTask(id, scope)).toBeUndefined();
    expect(await sendToTask(id, "continue", scope)).toEqual({
      ok: false,
      error: "Task not found",
    });
    expect(
      await stopAgentTeamBackgroundRun(`run-task-${id}`, "user", scope),
    ).toEqual({ ok: false, error: "Task not found" });
    expect([...appState.entries()]).toEqual(before);
    expect(fixtures.dispatch).not.toHaveBeenCalled();
    expect(fixtures.abort).not.toHaveBeenCalled();
  },
);

it.each([null, "", "   "])(
  "fails closed for unavailable trusted app %s",
  async (sourceAppId) => {
    const invalidScope = { ...scope, sourceAppId };
    expect(await listTasks(invalidScope)).toEqual([]);
    expect(await getTask("local", invalidScope)).toBeUndefined();
    expect(await sendToTask("local", "continue", invalidScope)).toEqual({
      ok: false,
      error: "Task not found",
    });
    expect(
      await stopAgentTeamBackgroundRun("run-task-local", "user", invalidScope),
    ).toEqual({ ok: false, error: "Task not found" });
    expect(fixtures.dispatch).not.toHaveBeenCalled();
    expect(fixtures.abort).not.toHaveBeenCalled();
  },
);

it("retains proper same-app get, send and stop", async () => {
  expect(await getTask("local", scope)).toMatchObject({ taskId: "local" });
  expect(await sendToTask("local", "continue", scope)).toMatchObject({
    ok: true,
    queuedCount: 1,
  });
  expect(
    await stopAgentTeamBackgroundRun("run-task-local", "user", scope),
  ).toEqual({ ok: true });
  expect(fixtures.abort).toHaveBeenCalledWith("run-task-local", "user", {
    allowNotStarted: true,
  });
  expect(appState.get("agent-task:local")).toMatchObject({
    status: "errored",
    summary: "Task stopped.",
  });
});

it("keeps explicit internal aggregation without dropping its owner and organization boundaries", async () => {
  expect(
    (await listTasks({ ownerEmail: scope.ownerEmail, orgId: scope.orgId }))
      .map((task) => task.taskId)
      .sort(),
  ).toEqual(["foreign", "legacy", "local"]);
});
