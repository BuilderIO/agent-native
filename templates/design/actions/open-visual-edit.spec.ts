import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addLocalhostScreensRun: vi.fn(),
  connectLocalhostRun: vi.fn(),
  createDesignRun: vi.fn(),
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
  buildDeepLink: ({
    to,
  }: {
    app: string;
    view: string;
    params: Record<string, unknown>;
    to: string;
  }) => `agent-native://open${to}`,
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
    mocks.connectLocalhostRun.mockReset();
    mocks.createDesignRun.mockReset();
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
});
