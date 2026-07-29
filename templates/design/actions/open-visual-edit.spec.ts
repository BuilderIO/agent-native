import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addLocalhostScreensRun: vi.fn(),
  addSession: vi.fn(),
  connectLocalhostRun: vi.fn(),
  createDesignRun: vi.fn(),
  getRequestUserEmail: vi.fn(),
  navigateRun: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
  embedApp: (config: unknown) => config,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/server", () => ({
  addSession: mocks.addSession,
  buildDeepLink: ({
    to,
  }: {
    app: string;
    view: string;
    params: Record<string, unknown>;
    to: string;
  }) => `agent-native://open${to}`,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("./connect-localhost.js", () => ({
  default: {
    run: mocks.connectLocalhostRun,
  },
}));

vi.mock("./add-localhost-screens.js", () => ({
  default: {
    run: mocks.addLocalhostScreensRun,
  },
  pathFromUrl: (_baseUrl: string, _url: string, fallback?: string) =>
    fallback ?? "/",
  routeUrl: (baseUrl: string, route: { path?: string; url?: string }) =>
    new URL(route.url ?? route.path ?? "/", `${baseUrl}/`).toString(),
}));

vi.mock("./create-design.js", () => ({
  default: {
    run: mocks.createDesignRun,
  },
}));

vi.mock("./navigate.js", () => ({
  default: {
    run: mocks.navigateRun,
  },
}));

import action from "./open-visual-edit.js";

describe("open-visual-edit", () => {
  beforeEach(() => {
    mocks.addLocalhostScreensRun.mockReset();
    mocks.addSession.mockReset();
    mocks.addSession.mockResolvedValue(undefined);
    mocks.connectLocalhostRun.mockReset();
    mocks.createDesignRun.mockReset();
    mocks.getRequestUserEmail.mockReset();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.navigateRun.mockReset();
    mocks.writeAppState.mockReset();

    mocks.connectLocalhostRun.mockResolvedValue({
      id: "localhost_canonical",
      bridgeUrl: "http://127.0.0.1:7331",
      rootPath: "/tmp/app",
      bridgeToken: "stored-write-token",
      previewToken: "stored-preview-token",
    });
    mocks.addLocalhostScreensRun.mockResolvedValue({
      screenCount: 1,
      screens: [{ id: "screen_1" }],
      placedFrames: [{ fileId: "screen_1" }],
    });
  });

  it("advertises the host coding-agent handoff on its MCP App resource", () => {
    expect(action.mcpApp.resource.description).toContain("host coding agent");
  });

  it("uses the connection id returned by connect-localhost when no id is supplied", async () => {
    const result = await action.run({
      designId: "design_1",
      devServerUrl: "http://localhost:5173/",
      bridgeUrl: "http://127.0.0.1:7331",
      rootPath: "/tmp/app",
      routeManifest: {
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://localhost:5173",
        rootPath: "/tmp/app",
        routes: [{ path: "/", title: "Home" }],
      },
      navigate: false,
    });

    expect(mocks.connectLocalhostRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: undefined,
        bridgeToken: undefined,
        previewToken: undefined,
        devServerUrl: "http://localhost:5173",
        rootPath: "/tmp/app",
      }),
    );
    expect(mocks.addLocalhostScreensRun).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "design_1",
        connectionId: "localhost_canonical",
      }),
    );
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "visual-edit",
      expect.objectContaining({
        designId: "design_1",
        connectionId: "localhost_canonical",
        bridgeUrl: "http://127.0.0.1:7331",
      }),
    );
    expect(result.connectionId).toBe("localhost_canonical");
    expect(result.bridgeToken).toBe("stored-write-token");
    expect(result.previewToken).toBe("stored-preview-token");
  });

  it("passes an explicit connection id through for follow-up visual-edit calls", async () => {
    await action.run({
      designId: "design_1",
      connectionId: "localhost_existing",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7331",
      rootPath: "/tmp/app",
      paths: ["/settings"],
      navigate: false,
    });

    expect(mocks.connectLocalhostRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "localhost_existing",
      }),
    );
  });

  it("expands each path across viewports as a row-per-route, column-per-viewport grid", async () => {
    await action.run({
      designId: "design_1",
      connectionId: "localhost_existing",
      devServerUrl: "http://localhost:5173",
      paths: ["/tasks", "/inbox"],
      viewports: ["desktop", "mobile"],
      navigate: false,
    });

    const routes = mocks.addLocalhostScreensRun.mock.calls[0]![0].routes;
    expect(routes).toEqual([
      expect.objectContaining({
        path: "/tasks",
        width: 1280,
        height: 900,
        x: 0,
        y: 0,
        title: "Tasks — Desktop",
      }),
      expect.objectContaining({
        path: "/tasks",
        width: 390,
        height: 844,
        x: 1440,
        y: 0,
        title: "Tasks — Mobile",
      }),
      expect.objectContaining({
        path: "/inbox",
        width: 1280,
        height: 900,
        x: 0,
        y: 1060,
        title: "Inbox — Desktop",
      }),
      expect.objectContaining({
        path: "/inbox",
        width: 390,
        height: 844,
        x: 1440,
        y: 1060,
      }),
    ]);
    // paths must not also be forwarded, or add-localhost-screens would ignore
    // the expanded routes and place one default-size frame per path instead.
    expect(
      mocks.addLocalhostScreensRun.mock.calls[0]![0].paths,
    ).toBeUndefined();
  });

  it("accepts explicit viewport sizes and leaves a single viewport's titles alone", async () => {
    await action.run({
      designId: "design_1",
      connectionId: "localhost_existing",
      devServerUrl: "http://localhost:5173",
      routes: [{ path: "/pricing", title: "Pricing" }],
      viewports: [{ label: "Wide", width: 1920, height: 1080 }],
      navigate: false,
    });

    expect(mocks.addLocalhostScreensRun.mock.calls[0]![0].routes).toEqual([
      expect.objectContaining({
        path: "/pricing",
        title: "Pricing",
        width: 1920,
        height: 1080,
      }),
    ]);
  });

  it("falls back to the manifest routes when viewports are requested without paths", async () => {
    await action.run({
      designId: "design_1",
      connectionId: "localhost_existing",
      devServerUrl: "http://localhost:5173",
      routeManifest: {
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://localhost:5173",
        routes: [{ path: "/", title: "Home" }],
      },
      viewports: ["mobile"],
      navigate: false,
    });

    expect(mocks.addLocalhostScreensRun.mock.calls[0]![0].routes).toEqual([
      expect.objectContaining({ path: "/", width: 390, height: 844 }),
    ]);
  });

  it("fails loudly when viewports are requested but no route can be resolved", async () => {
    await expect(
      action.run({
        designId: "design_1",
        connectionId: "localhost_existing",
        devServerUrl: "http://localhost:5173",
        viewports: ["desktop", "mobile"],
        navigate: false,
      }),
    ).rejects.toThrow(/viewports needs at least one route/);
  });

  it("accepts the complete capability list emitted by design connect route discovery", () => {
    const parsed = action.schema.safeParse({
      designId: "design_1",
      devServerUrl: "http://localhost:5173",
      capabilities: [
        { operation: "select", status: "available" },
        { operation: "resolveNodeToFile", status: "available" },
        { operation: "readFile", status: "available" },
        { operation: "applyEdit", status: "available" },
        { operation: "writeFile", status: "available" },
        { operation: "captureSnapshot", status: "available" },
        { operation: "captureState", status: "available" },
        { operation: "listFiles", status: "available" },
      ],
      paths: ["/"],
    });

    expect(parsed.success).toBe(true);
  });

  it("mints a caller session and embeds it in openUrl so an anonymous /visual-edit browser signs in as the caller", async () => {
    const result = await action.run({
      designId: "design_1",
      devServerUrl: "http://localhost:5173",
      paths: ["/"],
      navigate: false,
    });

    expect(mocks.addSession).toHaveBeenCalledTimes(1);
    const [token, email] = mocks.addSession.mock.calls[0]!;
    expect(email).toBe("owner@example.com");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    expect(result.openUrl).toBe(
      `agent-native://open/design/design_1?editorView=overview&_session=${token}`,
    );
    // The agent-surfaced "Open overview" link reuses the same session-bearing
    // URL rather than a bare read-only deep link.
    expect(action.link!({ args: {}, result }).url).toBe(result.openUrl);
  });

  it("does not mint or attach a session when the action has no authenticated caller", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    const result = await action.run({
      designId: "design_1",
      devServerUrl: "http://localhost:5173",
      paths: ["/"],
      navigate: false,
    });

    expect(mocks.addSession).not.toHaveBeenCalled();
    expect(result.openUrl).toBe(
      "agent-native://open/design/design_1?editorView=overview",
    );
  });
});
