import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyStaleReactRouterRouteError,
  createReactRouterRecoveryCoordinator,
  extractViteLoadUrlPath,
} from "./react-router-dev-recovery.js";

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
    return { root, routes };
  }

  it("extracts resolved absolute and /@fs/ load paths", () => {
    const file = path.join(os.tmpdir(), "missing-route.tsx");
    expect(extractViteLoadUrlPath(loadError(file))).toBe(file);
    expect(
      extractViteLoadUrlPath(
        loadError(file, {
          id: `/@fs/${file}?v=1`,
        }),
      ),
    ).toBe(file);
  });

  it("finds a strict stale route error through nested causes", () => {
    const { routes } = routeFixture();
    const file = path.join(routes, "deleted.tsx");
    const wrapped = new Error("SSR import failed", {
      cause: new Error("runner failed", { cause: loadError(file) }),
    });

    expect(classifyStaleReactRouterRouteError(wrapped, [routes])).toEqual({
      file,
    });
  });

  it.each([
    ["wrong code", { code: "ERR_MODULE_NOT_FOUND" }],
    ["wrong importer", { message: "Failed to load url /tmp/nope.tsx" }],
  ])("rejects %s", (_label, overrides) => {
    const { routes } = routeFixture();
    const file = path.join(routes, "deleted.tsx");
    expect(
      classifyStaleReactRouterRouteError(loadError(file, overrides), [routes]),
    ).toBeUndefined();
  });

  it("rejects existing route transforms and missing imports outside route roots", () => {
    const { root, routes } = routeFixture();
    const existing = path.join(routes, "syntax-error.tsx");
    fs.writeFileSync(existing, "export default (");
    const outside = path.join(root, "lib", "missing.ts");

    expect(
      classifyStaleReactRouterRouteError(loadError(existing), [routes]),
    ).toBeUndefined();
    expect(
      classifyStaleReactRouterRouteError(loadError(outside), [routes]),
    ).toBeUndefined();
    expect(
      classifyStaleReactRouterRouteError(
        Object.assign(new Error("loader failed"), {
          code: "ERR_LOAD_URL",
          importer: "virtual:react-router/server-build",
        }),
        [routes],
      ),
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
    const coordinator = createReactRouterRecoveryCoordinator(["/app/routes"], {
      restart,
      now: () => now,
      cooldownMs: 100,
    });

    expect(coordinator.request("delete a")).toBe("started");
    expect(coordinator.request("add b")).toBe("pending");
    expect(coordinator.request("add c")).toBe("pending");
    expect(restart).toHaveBeenCalledOnce();

    finishRestart?.();
    await Promise.resolve();
    await Promise.resolve();
    now += 100;
    await vi.runOnlyPendingTimersAsync();
    expect(restart).toHaveBeenCalledTimes(2);
  });

  it("keeps attempt bounds across coordinator replacement", () => {
    const key = `route-recovery-${crypto.randomUUID()}`;
    const first = createReactRouterRecoveryCoordinator(["/app/routes"], {
      restart: async () => {},
      maxConsecutiveAttempts: 1,
      persistentStateKey: key,
    });
    expect(first.request("first")).toBe("started");
    first.dispose();

    const replacement = createReactRouterRecoveryCoordinator(["/app/routes"], {
      restart: async () => {},
      maxConsecutiveAttempts: 1,
      persistentStateKey: key,
    });
    expect(replacement.request("loop")).toBe("bounded");
    replacement.markSsrSuccess();
    expect(replacement.request("after success")).toBe("started");
  });

  it("enforces cooldown and a bounded consecutive attempt count", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const restart = vi.fn(async () => {});
    const coordinator = createReactRouterRecoveryCoordinator(["/app/routes"], {
      restart,
      now: () => now,
      cooldownMs: 50,
      maxConsecutiveAttempts: 2,
    });

    expect(coordinator.request("first")).toBe("started");
    await Promise.resolve();
    await Promise.resolve();
    expect(coordinator.request("too soon")).toBe("cooldown");
    now += 50;
    await vi.runOnlyPendingTimersAsync();
    expect(restart).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(coordinator.request("third")).toBe("bounded");

    coordinator.markSsrSuccess();
    now += 50;
    expect(coordinator.request("after success")).toBe("started");
  });
});
