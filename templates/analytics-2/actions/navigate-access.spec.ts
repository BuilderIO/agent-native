import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  write: vi.fn(),
  project: vi.fn(),
  thread: vi.fn(),
  workspace: vi.fn(),
  collections: vi.fn(),
  connections: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppStateForCurrentTab: state.write,
}));
vi.mock("../server/lib/project-action-access.js", () => ({
  requireReadableProject: state.project,
}));
vi.mock("./get-thread-summary.js", () => ({ default: { run: state.thread } }));
vi.mock("../server/lib/analytics-capabilities.js", () => ({
  requireCapability: vi.fn().mockResolvedValue({ status: "allowed" }),
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: state.workspace,
}));
vi.mock("../server/model/collections-store.js", () => ({
  listCollections: state.collections,
}));
vi.mock("../server/model/data-connections.js", () => ({
  listDataConnections: state.connections,
}));
import navigate from "./navigate.js";

beforeEach(() => {
  vi.resetAllMocks();
  state.workspace.mockResolvedValue({
    ownerEmail: "owner@example.test",
    orgId: "org-1",
  });
  state.project.mockRejectedValue(
    Object.assign(new Error("Project not found"), {
      errorCode: "project_not_found",
    }),
  );
  state.thread.mockRejectedValue(
    Object.assign(new Error("Thread not found"), { errorCode: "not_found" }),
  );
  state.collections.mockResolvedValue([]);
  state.connections.mockResolvedValue([]);
});

it.each([
  [{ projectId: "missing" }, "project_not_found"],
  [{ path: "/project/missing/latest/" }, "project_not_found"],
  [{ path: "/home/../project/missing/latest" }, "project_not_found"],
  [{ view: "project/missing/latest" }, "project_not_found"],
  [{ path: "/app/missing/latest" }, "project_not_found"],
  [{ path: "/PROJECT/missing" }, "project_not_found"],
  [{ path: "/%70roject/missing" }, "project_not_found"],
  [{ path: "/component/missing/latest" }, "project_not_found"],
  [{ path: "/screenshot/missing/latest/session" }, "project_not_found"],
  [{ path: "/code-app/missing/latest" }, "project_not_found"],
  [{ threadId: "missing" }, "not_found"],
  [{ path: "/thread/missing/" }, "not_found"],
  [{ view: "thread/missing" }, "not_found"],
  [{ path: "/dev/agent-chat-thread/missing" }, "not_found"],
  [{ collectionId: "missing" }, "not_found"],
  [{ path: "/collection/missing/" }, "not_found"],
  [{ view: "collection/missing" }, "not_found"],
  [{ dataConnectionId: "missing" }, "not_found"],
  [
    { dataConnectionId: "missing", tableId: "table:sample:PUBLIC:orders" },
    "not_found",
  ],
  [
    {
      path: "/home/data/all/table/dsr1%3A%255B%2522missing%2522%252C%2522table%2522%252C%2522table%253Asample%253APUBLIC%253Aorders%2522%255D",
    },
    "not_found",
  ],
  [{ path: "/home/data/all/data-connection/missing/" }, "not_found"],
  [{ view: "home/data/all/data-connection/missing" }, "not_found"],
] as const)(
  "rejects inaccessible %j before navigating",
  async (input, errorCode) => {
    await expect(
      navigate.run(input, { appId: "analytics-2" } as never),
    ).rejects.toMatchObject({ errorCode });
    expect(state.write).not.toHaveBeenCalled();
  },
);

it("allows ordinary routes and accessible nested collections", async () => {
  state.collections.mockResolvedValue([
    { id: "parent", children: [{ id: "found", children: [] }] },
  ]);
  await navigate.run({ path: "/home/../collection/found/" }, {} as never);
  await navigate.run({ view: "home/settings" }, {} as never);
  expect(state.write).toHaveBeenCalledTimes(2);
});

it("propagates unreadable scoped lookups without queuing navigation", async () => {
  state.connections.mockRejectedValue(
    Object.assign(new Error("Unavailable"), {
      errorCode: "data_connection_unavailable",
    }),
  );
  await expect(
    navigate.run({ dataConnectionId: "missing" }, {} as never),
  ).rejects.toMatchObject({ errorCode: "data_connection_unavailable" });
  expect(state.write).not.toHaveBeenCalled();
});

it.each([
  { projectId: ".." },
  { path: "/\t/example.test" },
  { path: "/project/%ZZ" },
  { path: "/home/data/all/table/dsr1%3Anot-json" },
])("rejects unsafe or malformed %j", async (input) => {
  await expect(navigate.run(input, {} as never)).rejects.toMatchObject({
    errorCode: "invalid_navigation",
  });
  expect(state.write).not.toHaveBeenCalled();
});

it.each([
  "/home/explorations",
  "/explore/project",
  "/explore-new/project/example",
  "/explore-error",
  "/context-studio/overview",
  "/context-studio/guides",
  "/context-studio/evals/compare",
  "/model-workbench/model",
  "/home/data/semantic-layer",
  "/settings/project-security",
  "/settings/scheduled-runs",
])("does not queue agent links to the unavailable route %s", async (path) => {
  await expect(navigate.run({ path })).rejects.toMatchObject({
    statusCode: 404,
    errorCode: "missing_backing",
  });
  expect(state.write).not.toHaveBeenCalled();
});
