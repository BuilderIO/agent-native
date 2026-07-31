import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyStaleReactRouterRouteError,
  createReactRouterRecoveryCoordinator,
  extractViteLoadUrlPath,
  type ReactRouterRecoveryCoordinator,
  type ReactRouterRouteScope,
} from "./react-router-dev-recovery.js";

const EMPTY_SCOPE: ReactRouterRouteScope = {
  exactRouteFiles: [],
  discoveryRoots: [],
};

function discoveryScope(routes: string): ReactRouterRouteScope {
  return {
    exactRouteFiles: [],
    discoveryRoots: [
      {
        appDirectory: path.dirname(routes),
        directory: routes,
        ignoredRouteFiles: [],
      },
    ],
  };
}

function requestFallback(
  coordinator: ReactRouterRecoveryCoordinator,
  modulePath: string,
  requestPathname: string,
  reason = "stale SSR",
) {
  return coordinator.requestFallback({ modulePath, requestPathname, reason });
}

function loadError(file: string, overrides: Record<string, unknown> = {}) {
  return Object.assign(
    new Error(
      `Failed to load url ${file} (resolved id: ${file}) in virtual:react-router/server-build. Does the file exist?`,
    ),
    { code: "ERR_LOAD_URL", ...overrides },
  );
}

describe("stale React Router route classification", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs)
      fs.rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  function routeFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-route-recovery-"));
    tempDirs.push(root);
    const routes = path.join(root, "app", "routes");
    fs.mkdirSync(routes, { recursive: true });
    return { root, routes, scope: discoveryScope(routes) };
  }

  it("extracts resolved absolute and /@fs/ load paths", () => {
    const file = path.join(os.tmpdir(), "missing-route.tsx");
    expect(extractViteLoadUrlPath(loadError(file))).toBe(file);
    expect(
      extractViteLoadUrlPath(loadError(file, { id: `/@fs/${file}?v=1` })),
    ).toBe(file);
  });

  it("finds a strict stale route error through nested causes", () => {
    const { routes, scope } = routeFixture();
    const file = path.join(routes, "deleted.tsx");
    const wrapped = new Error("SSR import failed", {
      cause: new Error("runner failed", { cause: loadError(file) }),
    });

    expect(classifyStaleReactRouterRouteError(wrapped, scope)).toEqual({
      file,
    });
  });

  it("combines code, importer, and route path evidence within one cause chain", () => {
    const { routes, scope } = routeFixture();
    const file = path.join(routes, "deleted.tsx");
    const pathError = Object.assign(new Error(`Failed to load url ${file}`), {
      id: file,
    });
    const codeError = Object.assign(new Error("Vite transform failed"), {
      code: "ERR_LOAD_URL",
      cause: pathError,
    });
    const wrapped = Object.assign(
      new Error("SSR import failed", { cause: codeError }),
      { importer: "virtual:react-router/server-build" },
    );

    expect(classifyStaleReactRouterRouteError(wrapped, scope)).toEqual({
      file,
    });
  });

  it("does not combine stale-load evidence across sibling error branches", () => {
    const { routes, scope } = routeFixture();
    const file = path.join(routes, "deleted.tsx");
    const wrapped = new AggregateError([
      Object.assign(new Error("Vite transform failed"), {
        code: "ERR_LOAD_URL",
      }),
      Object.assign(new Error(`Failed to load url ${file}`), {
        id: file,
        importer: "virtual:react-router/server-build",
      }),
    ]);

    expect(classifyStaleReactRouterRouteError(wrapped, scope)).toBeUndefined();
  });

  it.each([
    ["wrong code", { code: "ERR_MODULE_NOT_FOUND" }],
    ["wrong importer", { message: "Failed to load url /tmp/nope.tsx" }],
  ])("rejects %s", (_label, overrides) => {
    const { routes, scope } = routeFixture();
    const file = path.join(routes, "deleted.tsx");
    expect(
      classifyStaleReactRouterRouteError(loadError(file, overrides), scope),
    ).toBeUndefined();
  });

  it("rejects existing transforms and missing imports outside route scope", () => {
    const { root, routes, scope } = routeFixture();
    const existing = path.join(routes, "syntax-error.tsx");
    fs.writeFileSync(existing, "export default (");
    const outside = path.join(root, "lib", "missing.ts");

    expect(
      classifyStaleReactRouterRouteError(loadError(existing), scope),
    ).toBeUndefined();
    expect(
      classifyStaleReactRouterRouteError(loadError(outside), scope),
    ).toBeUndefined();
    expect(
      classifyStaleReactRouterRouteError(
        Object.assign(new Error("loader failed"), {
          code: "ERR_LOAD_URL",
          importer: "virtual:react-router/server-build",
        }),
        scope,
      ),
    ).toBeUndefined();
  });

  it("accepts an absent exact explicit route without broadening its parent", () => {
    const { root } = routeFixture();
    const exact = path.join(root, "app", "dashboard.tsx");
    const sibling = path.join(root, "app", "not-a-route.tsx");
    const scope = { exactRouteFiles: [exact], discoveryRoots: [] };

    expect(classifyStaleReactRouterRouteError(loadError(exact), scope)).toEqual(
      {
        file: exact,
      },
    );
    expect(
      classifyStaleReactRouterRouteError(loadError(sibling), scope),
    ).toBeUndefined();
  });
});

describe("React Router recovery coordinator", () => {
  afterEach(() => vi.useRealTimers());

  it("serializes restart requests with one pending rerun", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    let finishRestart: (() => void) | undefined;
    const restart = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRestart = resolve;
        }),
    );
    const coordinator = createReactRouterRecoveryCoordinator(EMPTY_SCOPE, {
      restart,
      now: () => now,
      cooldownMs: 100,
    });

    expect(coordinator.requestTopology("delete a")).toBe("started");
    expect(coordinator.requestTopology("add b")).toBe("pending");
    expect(coordinator.requestTopology("add c")).toBe("pending");
    expect(restart).toHaveBeenCalledOnce();

    finishRestart?.();
    await Promise.resolve();
    await Promise.resolve();
    now += 100;
    await vi.runOnlyPendingTimersAsync();
    expect(restart).toHaveBeenCalledTimes(2);
  });

  it("continues proactive topology rebuilds beyond the fallback bound", async () => {
    const restart = vi.fn(async () => {});
    const coordinator = createReactRouterRecoveryCoordinator(EMPTY_SCOPE, {
      restart,
      cooldownMs: 0,
      maxConsecutiveAttempts: 3,
    });

    for (let index = 0; index < 5; index += 1) {
      expect(coordinator.requestTopology(`topology ${index}`)).toBe("started");
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(restart).toHaveBeenCalledTimes(5);
  });

  it("shares fallback bounds by module across request paths", async () => {
    const restart = vi.fn(async () => {});
    const coordinator = createReactRouterRecoveryCoordinator(EMPTY_SCOPE, {
      restart,
      cooldownMs: 0,
      maxConsecutiveAttempts: 2,
    });
    const module = "/app/routes/deleted.tsx";

    expect(requestFallback(coordinator, module, "/one")).toBe("started");
    await new Promise((resolve) => setImmediate(resolve));
    expect(requestFallback(coordinator, module, "/two")).toBe("started");
    await new Promise((resolve) => setImmediate(resolve));
    expect(requestFallback(coordinator, module, "/three")).toBe("bounded");
  });

  it("does not reset a stale module bound after unrelated healthy SSR", async () => {
    const restart = vi.fn(async () => {});
    const coordinator = createReactRouterRecoveryCoordinator(EMPTY_SCOPE, {
      restart,
      cooldownMs: 0,
      maxConsecutiveAttempts: 2,
    });
    const module = "/app/routes/deleted.tsx";

    expect(requestFallback(coordinator, module, "/broken")).toBe("started");
    await new Promise((resolve) => setImmediate(resolve));
    coordinator.markSsrSuccess("/healthy");
    expect(requestFallback(coordinator, module, "/also-broken")).toBe(
      "started",
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(requestFallback(coordinator, module, "/third-path")).toBe("bounded");

    coordinator.markSsrSuccess("/broken");
    expect(requestFallback(coordinator, module, "/third-path")).toBe("started");
  });

  it("keeps module attempt bounds across coordinator replacement", () => {
    const key = `route-recovery-${crypto.randomUUID()}`;
    const options = {
      restart: async () => {},
      cooldownMs: 0,
      maxConsecutiveAttempts: 1,
      persistentStateKey: key,
    };
    const module = "/app/routes/deleted.tsx";
    const first = createReactRouterRecoveryCoordinator(EMPTY_SCOPE, options);
    expect(requestFallback(first, module, "/broken")).toBe("started");
    first.dispose();

    const replacement = createReactRouterRecoveryCoordinator(
      EMPTY_SCOPE,
      options,
    );
    expect(requestFallback(replacement, module, "/other")).toBe("bounded");
    replacement.markSsrSuccess("/broken");
    expect(requestFallback(replacement, module, "/after-success")).toBe(
      "started",
    );
  });

  it("serializes mixed pending requests without bypassing fallback bounds", async () => {
    vi.useFakeTimers();
    const finishes: Array<() => void> = [];
    const restart = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishes.push(resolve);
        }),
    );
    const coordinator = createReactRouterRecoveryCoordinator(EMPTY_SCOPE, {
      restart,
      cooldownMs: 0,
      maxConsecutiveAttempts: 1,
    });
    const module = "/app/routes/deleted.tsx";

    expect(requestFallback(coordinator, module, "/broken")).toBe("started");
    expect(coordinator.requestTopology("route added")).toBe("pending");
    expect(requestFallback(coordinator, module, "/other")).toBe("bounded");
    expect(restart).toHaveBeenCalledOnce();

    finishes[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
    expect(restart).toHaveBeenCalledTimes(2);
    expect(requestFallback(coordinator, module, "/still-stale")).toBe(
      "bounded",
    );
  });
});
