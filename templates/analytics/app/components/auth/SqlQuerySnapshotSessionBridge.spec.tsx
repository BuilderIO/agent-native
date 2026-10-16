// @vitest-environment happy-dom

import { act, useEffect } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = { userId: "user-1", email: "one@example.com", orgId: "org-1" };
const SCOPE = "user-1:org-1";
const OTHER_SCOPE = "user-9:org-1";

function sessionResponse(): Response {
  return new Response(JSON.stringify(SESSION), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Every module is loaded fresh so the core session store, which lives at
 * module level, starts at "loading" in each test and the gate, the bridge and
 * the helper all share one copy of it.
 */
async function loadApp() {
  vi.resetModules();
  const hooks = await import("@agent-native/core/client/hooks");
  const { RequireSession } = await import("@agent-native/toolkit/app/auth");
  const { SqlQuerySnapshotSessionBridge } =
    await import("./SqlQuerySnapshotSessionBridge");
  const cache = await import("@/lib/sql-query-cache");
  const session = await import("@/lib/sql-query-snapshot-session");
  return {
    hooks,
    RequireSession,
    SqlQuerySnapshotSessionBridge,
    cache,
    session,
  };
}

describe("SqlQuerySnapshotSessionBridge", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalLocation: Location;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/dashboards",
        search: "",
        hash: "",
        origin: "https://analytics.example.com",
        hostname: "analytics.example.com",
        href: "https://analytics.example.com/dashboards",
        replace: vi.fn(),
        assign: vi.fn(),
        reload: vi.fn(),
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sessionResponse()),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function seed(
    cache: Awaited<ReturnType<typeof loadApp>>["cache"],
    accountScope: string,
    queryKey = "key-1",
  ) {
    const write = cache.writeSqlQuerySnapshot({
      accountScope,
      queryKey,
      result: { rows: [{ n: 1 }], fetchedAt: new Date().toISOString() },
    });
    expect(write.status).toBe("written");
  }
  const saved = (
    cache: Awaited<ReturnType<typeof loadApp>>["cache"],
    accountScope: string,
    queryKey = "key-1",
  ) => cache.readSqlQuerySnapshot({ accountScope, queryKey }).status;

  const mount = (ui: ReactElement) =>
    act(async () => {
      root.render(ui);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  function appTree(
    app: Awaited<ReturnType<typeof loadApp>>,
    unmounts: string[],
  ) {
    const { RequireSession, SqlQuerySnapshotSessionBridge } = app;
    function Probe() {
      useEffect(() => () => void unmounts.push("app"), []);
      return <p>app</p>;
    }
    return (
      <>
        <SqlQuerySnapshotSessionBridge />
        <RequireSession fallback={<p>gate</p>}>
          <Probe />
        </RequireSession>
      </>
    );
  }

  it("keeps the signed-in account's results and drops every other account's", async () => {
    const app = await loadApp();
    seed(app.cache, SCOPE);
    seed(app.cache, OTHER_SCOPE);

    await mount(appTree(app, []));

    expect(container.textContent).toBe("app");
    expect(saved(app.cache, SCOPE)).toBe("hit");
    expect(saved(app.cache, OTHER_SCOPE)).toBe("miss");
    expect(app.session.canWriteSqlQuerySnapshot(SCOPE)).toBe(true);
    expect(app.session.canWriteSqlQuerySnapshot(OTHER_SCOPE)).toBe(false);
  });

  it("clears the results when core's sign-out unmounts the gate, and refuses late writes", async () => {
    const app = await loadApp();
    const unmounts: string[] = [];
    seed(app.cache, SCOPE);
    await mount(appTree(app, unmounts));
    expect(saved(app.cache, SCOPE)).toBe("hit");

    await act(async () => {
      app.hooks.beginSignOut();
    });

    expect(unmounts).toEqual(["app"]);
    expect(container.textContent).toBe("gate");
    expect(saved(app.cache, SCOPE)).toBe("miss");
    expect(app.session.canWriteSqlQuerySnapshot(SCOPE)).toBe(false);
    expect(
      app.session.writeSqlQuerySnapshotForSession({
        accountScope: SCOPE,
        queryKey: "key-1",
        result: { rows: [{ n: 2 }] },
      }),
    ).toEqual({ status: "skipped", reason: "session-changed" });
    expect(saved(app.cache, SCOPE)).toBe("miss");
  });

  it("clears the results through core's real signOut, not only beginSignOut", async () => {
    const app = await loadApp();
    seed(app.cache, SCOPE);
    await mount(appTree(app, []));
    const logout = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", logout);

    await act(async () => {
      await app.hooks.signOut({ redirectTo: "/sign-in" });
    });

    expect(logout).toHaveBeenCalledWith(
      expect.stringContaining("/auth/logout"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(saved(app.cache, SCOPE)).toBe("miss");
  });

  it("is why a cleanup inside the gate cannot do this job", async () => {
    const app = await loadApp();
    seed(app.cache, SCOPE);
    const { RequireSession } = app;
    function InsideGateCleanup() {
      const { session, status } = app.hooks.useSession();
      useEffect(() => {
        app.session.syncSqlQuerySnapshotsToSession({ status, session });
      }, [status, session]);
      return <p>app</p>;
    }

    await mount(
      <RequireSession fallback={<p>gate</p>}>
        <InsideGateCleanup />
      </RequireSession>,
    );
    await act(async () => {
      app.hooks.beginSignOut();
    });

    expect(container.textContent).toBe("gate");
    expect(saved(app.cache, SCOPE)).toBe("hit");
  });

  it("clears nothing when the app unmounts without a sign-out", async () => {
    const app = await loadApp();
    seed(app.cache, SCOPE);
    await mount(appTree(app, []));

    act(() => root.unmount());
    root = createRoot(container);

    expect(saved(app.cache, SCOPE)).toBe("hit");
    expect(app.session.canWriteSqlQuerySnapshot(SCOPE)).toBe(true);
  });
});

describe("syncSqlQuerySnapshotsToSession", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.resetModules();
  });

  it("leaves everything alone while the session is loading or unavailable", async () => {
    const cache = await import("@/lib/sql-query-cache");
    const { syncSqlQuerySnapshotsToSession, canWriteSqlQuerySnapshot } =
      await import("@/lib/sql-query-snapshot-session");
    cache.writeSqlQuerySnapshot({
      accountScope: SCOPE,
      queryKey: "key-1",
      result: { rows: [] },
    });

    for (const status of ["loading", "unavailable"] as const) {
      expect(
        syncSqlQuerySnapshotsToSession({ status, session: null }),
      ).toBeUndefined();
    }

    expect(
      cache.readSqlQuerySnapshot({ accountScope: SCOPE, queryKey: "key-1" })
        .status,
    ).toBe("hit");
    expect(canWriteSqlQuerySnapshot(SCOPE)).toBe(false);
  });

  it("clears everything on a terminal sign-out and keeps only the new account on a switch", async () => {
    const cache = await import("@/lib/sql-query-cache");
    const { syncSqlQuerySnapshotsToSession, canWriteSqlQuerySnapshot } =
      await import("@/lib/sql-query-snapshot-session");
    const write = (accountScope: string) =>
      cache.writeSqlQuerySnapshot({
        accountScope,
        queryKey: "key-1",
        result: { rows: [] },
      });
    const status = (accountScope: string) =>
      cache.readSqlQuerySnapshot({ accountScope, queryKey: "key-1" }).status;

    write(SCOPE);
    write(OTHER_SCOPE);
    syncSqlQuerySnapshotsToSession({
      status: "authenticated",
      session: { userId: "user-9", orgId: "org-1" },
    });
    expect([status(SCOPE), status(OTHER_SCOPE)]).toEqual(["miss", "hit"]);
    expect(canWriteSqlQuerySnapshot(OTHER_SCOPE)).toBe(true);

    syncSqlQuerySnapshotsToSession({
      status: "unauthenticated",
      session: null,
    });
    expect(status(OTHER_SCOPE)).toBe("miss");
    expect(canWriteSqlQuerySnapshot(OTHER_SCOPE)).toBe(false);
  });

  it("warns when saved results cannot be cleared", async () => {
    const { syncSqlQuerySnapshotsToSession } =
      await import("@/lib/sql-query-snapshot-session");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    const result = syncSqlQuerySnapshotsToSession({
      status: "signing-out",
      session: null,
    });

    expect(result).toMatchObject({ status: "unavailable" });
    expect(warn).toHaveBeenCalledWith(
      "[sql-query] could not clear saved results",
      { reason: "storage-error", errorName: "SecurityError" },
    );
    vi.restoreAllMocks();
  });
});
