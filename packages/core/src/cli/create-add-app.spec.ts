import fs from "fs";
import { createRequire } from "node:module";
import os from "os";
import path from "path";

import { createJiti } from "jiti";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clack = vi.hoisted(() => ({
  cancel: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  isCancel: vi.fn(() => false),
  multiselect: vi.fn(),
}));

vi.mock("@clack/prompts", () => clack);

import { addAppToWorkspace } from "./create.js";
import { coreTemplates } from "./templates-meta.js";

let originalCwd: string;
let workspaceRoot: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-add-app-test-"),
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "package.json"),
    JSON.stringify({
      "agent-native": { workspaceCore: "@test/shared" },
    }),
  );
  fs.mkdirSync(path.join(workspaceRoot, "apps"));
  fs.writeFileSync(
    path.join(workspaceRoot, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n",
  );
  process.chdir(workspaceRoot);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function mockExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code ?? 0})`);
  });
}

describe("workspace add-app selection feedback", () => {
  it("explains how to select an app when the picker is submitted empty", async () => {
    clack.multiselect.mockResolvedValueOnce([]);
    const exit = mockExit();

    await expect(addAppToWorkspace()).rejects.toThrow("process.exit(0)");

    expect(clack.multiselect).toHaveBeenCalledOnce();
    expect(clack.cancel).toHaveBeenCalledWith(
      "No apps selected. Press space to select an app, then press enter to continue.",
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("reports when every available app is already installed", async () => {
    for (const template of coreTemplates()) {
      fs.mkdirSync(path.join(workspaceRoot, "apps", template.name));
    }
    const exit = mockExit();

    await expect(addAppToWorkspace()).rejects.toThrow("process.exit(0)");

    expect(clack.multiselect).not.toHaveBeenCalled();
    expect(clack.cancel).toHaveBeenCalledWith(
      "All available apps are already installed.",
    );
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe("workspace chat starter", () => {
  it("scaffolds its capability manifest and runs tab-scoped screen and navigation actions", async () => {
    vi.stubEnv("AGENT_NATIVE_CREATE_USE_LOCAL_CORE", "0");
    clack.cancel.mockImplementationOnce((message: string) => {
      throw new Error(message);
    });
    await addAppToWorkspace("team-inbox", { template: "chat" });

    const appDir = path.join(workspaceRoot, "apps", "team-inbox");
    const coreDir = path.resolve(import.meta.dirname, "..");
    const require = createRequire(import.meta.url);
    const jiti = createJiti(import.meta.url, {
      alias: {
        "@agent-native/core/action": path.join(coreDir, "action.ts"),
        "@agent-native/core/application-state": path.join(
          coreDir,
          "application-state/index.ts",
        ),
        "@agent-native/core/command-navigation": path.join(
          coreDir,
          "command-navigation/index.ts",
        ),
        zod: require.resolve("zod"),
      },
    });
    const manifest = await jiti.import(path.join(appDir, "app.manifest.ts"), {
      default: true,
    });
    expect(manifest).toMatchObject({
      id: "team-inbox",
      displayName: "Team Inbox",
      screens: {
        defaultLandingScreen: "home",
        definitions: {
          home: { show: { route: "/home" } },
          thread: { show: { route: "/chat/:threadId" } },
        },
      },
      entities: { thread: { show: "thread" } },
      viewPolicy: { background: "keep", navigate: "open" },
      suggestableCapabilities: [],
    });
    expect(fs.existsSync(path.join(appDir, "DESIGN.md"))).toBe(true);
    const guidance = fs.readFileSync(path.join(appDir, "AGENTS.md"), "utf8");
    expect(guidance).toContain("Use the 12-row blind visual review");
    expect(guidance).not.toContain(
      "Skip production build and extra test suites",
    );

    const { appStateGet, appStatePut } = await jiti.import<
      typeof import("../application-state/store.js")
    >(path.join(coreDir, "application-state/store.ts"));
    const { runWithRequestContext } = await jiti.import<
      typeof import("../server/request-context.js")
    >(path.join(coreDir, "server/request-context.ts"));
    const view = await jiti.import<{
      run: (args: Record<string, never>) => Promise<unknown>;
    }>(path.join(appDir, "actions/view-screen.ts"), { default: true });
    const navigate = await jiti.import<{
      run: (
        args: {
          view?: string;
          path?: string;
          threadId?: string;
          intent?: "open";
        },
        ctx: { caller: "mcp" },
      ) => Promise<unknown>;
    }>(path.join(appDir, "actions/navigate.ts"), { default: true });

    const userEmail = "starter@example.test";
    const tabId = "active-tab";
    const navigation = {
      view: "chat",
      path: "/chat/thread-7",
      threadId: "thread-7",
    };
    await appStatePut(userEmail, `navigation:${tabId}`, navigation);
    await appStatePut(userEmail, `selection:${tabId}`, { ids: ["thread-7"] });
    await appStatePut(userEmail, "editor:other-tab", { dirty: true });
    await runWithRequestContext(
      { userEmail, run: { browserTabId: tabId } },
      async () => {
        await expect(view.run({})).resolves.toEqual({
          navigation,
          route: "/chat/thread-7",
          view: "chat",
          title: "Team Inbox",
          activeFilters: {},
          selection: ["thread-7"],
          visibleItems: [{ type: "thread", id: "thread-7" }],
        });
        await appStatePut(userEmail, `editor:${tabId}`, {
          dirty: true,
          userEditedSince: 17,
        });
        await expect(view.run({})).resolves.toMatchObject({
          liveDraft: { dirty: true },
          userEditedSince: 17,
        });
        const target = { view: "thread", threadId: "thread-8" };
        await expect(
          navigate.run(target, { caller: "mcp" }),
        ).resolves.toMatchObject({
          kept: true,
          navigated: false,
        });
        expect(await appStateGet(userEmail, `navigate:${tabId}`)).toBeNull();

        await expect(
          navigate.run({ ...target, intent: "open" }, { caller: "mcp" }),
        ).resolves.toMatchObject({
          kept: false,
          navigated: true,
          resolvedUrl: "/chat/thread-8",
          tabId: "active-tab",
          writeId: expect.any(String),
          message:
            "Queued navigation to /chat/thread-8. Use view-screen to confirm it opened.",
        });
        expect(await appStateGet(userEmail, `navigate:${tabId}`)).toMatchObject(
          {
            path: "/chat/thread-8",
          },
        );
        await expect(
          navigate.run(
            { path: "https://example.test", intent: "open" },
            { caller: "mcp" },
          ),
        ).rejects.toMatchObject({ errorCode: "invalid_navigation_target" });
      },
    );
  });
});
