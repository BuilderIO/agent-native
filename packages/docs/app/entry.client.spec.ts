// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const { hydrateRoot } = vi.hoisted(() => ({ hydrateRoot: vi.fn() }));

vi.mock("react-dom/client", () => ({ hydrateRoot }));
vi.mock("react-router/dom", () => ({ HydratedRouter: () => null }));
vi.mock("./components/doc-block-renderer", () => ({
  preloadDocBlocksContent: vi.fn(),
}));
vi.mock("./components/marketing-attribution", () => ({
  installAppLinkAttribution: vi.fn(),
}));
vi.mock("@agent-native/core/client/route-chunk-recovery", () => ({
  installRouteChunkRecovery: vi.fn(),
}));

afterEach(() => {
  delete (window as Window & { __AGENT_NATIVE_CONFIG__?: unknown })
    .__AGENT_NATIVE_CONFIG__;
  delete (window as Window & { __reactRouterContext?: unknown })
    .__reactRouterContext;
  window.history.replaceState(null, "", "/");
  hydrateRoot.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("docs client entry", () => {
  it("installs route chunk recovery", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "entry.client.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'import { installRouteChunkRecovery } from "@agent-native/core/client/route-chunk-recovery";',
    );
    expect(source).toMatch(/^installRouteChunkRecovery\(\);$/m);
  });

  it("preserves the server basename and hydrates when workspace mount metadata is unresolved", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "");
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON", "");
    vi.stubEnv("VITE_APP_BASE_PATH", "");
    vi.stubEnv("APP_BASE_PATH", "");
    window.history.replaceState(null, "", "/dispatch/home");

    const context = { basename: "/" };
    Object.assign(window, {
      __AGENT_NATIVE_CONFIG__: { workspaceRuntime: true },
      __reactRouterContext: context,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.resetModules();
    await import("./entry.client");

    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toBe(
      "Unable to resolve the workspace app mount; preserving the server router basename.",
    );
    expect(error.mock.calls[0]?.[1]).toMatchObject({
      name: "WorkspaceAppMountResolutionError",
      message:
        "Cannot resolve workspace app mount path without explicit mount metadata.",
    });
    expect(context.basename).toBe("/");
    expect(hydrateRoot).toHaveBeenCalledOnce();
    expect(error.mock.invocationCallOrder[0]).toBeLessThan(
      hydrateRoot.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("installs app-link attribution before hydrating", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "entry.client.tsx"),
      "utf8",
    );

    const install = source.search(/^installAppLinkAttribution\(\);$/m);
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(source.indexOf("hydrateRoot("));
  });
});
