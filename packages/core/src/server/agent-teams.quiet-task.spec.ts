import { beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => new Map<string, Record<string, unknown>>());

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

const createThreadMock = vi.hoisted(() =>
  vi.fn(async (_owner: string, _opts: Record<string, unknown>) => ({
    id: `thread-${Math.random().toString(36).slice(2, 8)}`,
  })),
);
vi.mock("../chat-threads/store.js", () => ({
  createThread: createThreadMock,
  updateThreadData: vi.fn(async () => {}),
  getThread: vi.fn(async () => null),
}));

const enqueueAgentTeamRunMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./agent-teams-run-queue.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-teams-run-queue.js")>();
  return { ...actual, enqueueAgentTeamRun: enqueueAgentTeamRunMock };
});

vi.mock("./self-dispatch.js", () => ({
  fireInternalDispatch: vi.fn(async () => {}),
}));

vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: vi.fn(async () => null),
}));

const startProgressRunMock = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("../progress/registry.js", () => ({
  startRun: startProgressRunMock,
  updateRunProgress: vi.fn(async () => ({})),
  completeRun: vi.fn(async () => ({})),
  getRun: vi.fn(async () => null),
}));

vi.mock("./request-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./request-context.js")>()),
  getRequestOrgId: () => undefined,
  getRequestRunContext: () => undefined,
  getRequestUserEmail: () => "owner@example.com",
  hasRequestContext: () => false,
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

const OWNER = "owner@example.com";

describe("spawnTask from app code", () => {
  beforeEach(() => {
    appState.clear();
    createThreadMock.mockClear();
    enqueueAgentTeamRunMock.mockClear();
    startProgressRunMock.mockClear();
  });

  it("starts a scoped, quiet task with no chat behind it", async () => {
    const { spawnTask } = await import("./agent-teams.js");

    const task = await spawnTask({
      description: "Fill the summary cell",
      ownerEmail: OWNER,
      scope: { type: "content-column-fill", id: "fill-1" },
      quiet: true,
      allowedActionNames: ["get-document", "fill-column-cell"],
    });

    expect(task.status).toBe("running");
    expect(task.parentThreadId).toBeUndefined();
    expect(createThreadMock).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({
        scope: { type: "content-column-fill", id: "fill-1" },
      }),
    );
    expect(enqueueAgentTeamRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          allowedActionNames: ["get-document", "fill-column-cell"],
        }),
      }),
    );
    expect(appState.get(`agent-task:${task.taskId}`)?.quiet).toBe(true);
    expect(startProgressRunMock).not.toHaveBeenCalled();
  });

  it("keeps quiet tasks out of the background run list", async () => {
    const { spawnTask, listAgentTeamBackgroundRuns } =
      await import("./agent-teams.js");

    const quiet = await spawnTask({
      description: "Fill a cell",
      ownerEmail: OWNER,
      quiet: true,
    });
    const visible = await spawnTask({
      description: "Research a topic",
      ownerEmail: OWNER,
    });

    const runs = await listAgentTeamBackgroundRuns({ ownerEmail: OWNER });
    const taskIds = runs.map((run) => run.sourceRecord.id);
    expect(taskIds).toContain(visible.taskId);
    expect(taskIds).not.toContain(quiet.taskId);
    expect(startProgressRunMock).toHaveBeenCalledTimes(1);
  });
});
