import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("./connect-localhost.js", () => ({
  default: {
    run: vi.fn(async () => ({
      id: "connection_1",
      bridgeUrl: "http://127.0.0.1:7331",
      rootPath: "/example/app",
      routes: [],
    })),
  },
  DEFAULT_BRIDGE_URL: "http://127.0.0.1:7331",
}));
vi.mock("./add-localhost-screens.js", () => ({
  default: {
    run: async () => ({ screenCount: 0, screens: [], placedFrames: [] }),
  },
  pathFromUrl: (_base: string, _url: string, fallback: string) => fallback,
  routeUrl: (base: string, route: { path: string }) =>
    new URL(route.path, base).toString(),
}));
vi.mock("./create-design.js", () => ({ default: { run: vi.fn() } }));
vi.mock("../server/lib/visual-edit-capability.js", () => ({
  linkVisualEditBoardConnections: vi.fn(),
}));

import {
  readAppState,
  deleteAppState,
} from "@agent-native/core/application-state";
import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server/request-context";

import { applicationStateStore } from "../../../packages/core/src/application-state/store.js";
import { linkVisualEditBoardConnections } from "../server/lib/visual-edit-capability.js";
import connectLocalhostAction from "./connect-localhost.js";
import createDesignAction from "./create-design.js";
import action from "./open-visual-edit.js";

const userEmail = "owner@example.com";
const context = {
  caller: "mcp" as const,
  actionName: "open-visual-edit",
  userEmail,
};
const args = { designId: "design_1", devServerUrl: "http://localhost:5173" };

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  await withMigrationRuntime(() => applicationStateStore.ready());
});

beforeEach(async () => {
  vi.clearAllMocks();
  await runWithRequestContext({ userEmail }, async () => {
    await deleteAppState("navigate");
    await deleteAppState("visual-edit");
  });
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("open-visual-edit navigation guard", () => {
  it("opens the overview for an MCP caller", async () => {
    await runWithRequestContext({ userEmail }, async () => {
      const result = await action.run(args, context);
      expect(result.designId).toBe("design_1");
      expect(await readAppState("navigate")).toEqual({
        view: "editor",
        designId: "design_1",
        editorView: "overview",
        path: "/visual-edit/design_1?editorView=overview&embedChrome=1",
      });
    });
  });

  it("leaves the current view alone when navigation is disabled", async () => {
    await runWithRequestContext({ userEmail }, async () => {
      await action.run({ ...args, navigate: false }, context);
      expect(await readAppState("navigate")).toBeNull();
    });
  });

  it.each([
    ["keep", { navigationMode: "keep" }, undefined, "navigation-mode-keep"],
    [
      "background",
      {},
      { viewportMode: "background" },
      "background-viewport-locked",
    ],
  ] as const)("respects %s navigation", async (_label, extra, run, reason) => {
    await runWithRequestContext({ userEmail, run }, async () => {
      await expect(
        action.run({ ...args, ...extra }, context),
      ).rejects.toMatchObject({
        code: "agent_navigation_refused",
        reason,
      });
      await expect(
        action.run(
          { devServerUrl: args.devServerUrl, newDesign: true, ...extra },
          context,
        ),
      ).rejects.toMatchObject({ code: "agent_navigation_refused", reason });
      expect(await readAppState("navigate")).toBeNull();
      expect(await readAppState("visual-edit")).toBeNull();
      expect(connectLocalhostAction.run).not.toHaveBeenCalled();
      expect(createDesignAction.run).not.toHaveBeenCalled();
      expect(linkVisualEditBoardConnections).not.toHaveBeenCalled();
    });
  });
});
