import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  appLocalEnv,
  canonicalLoopbackRedirect,
  isBrowserAssetDestination,
  markAppReady,
  selectProxyResponseTimeout,
  shouldEvict,
  shouldRestartPersistent5xx,
  shouldRestartStuckApp,
} from "./dev-lazy";

describe("dev-lazy app-local environment", () => {
  it("passes only app-scoped env values with local overrides", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-lazy-env-"));
    try {
      fs.writeFileSync(
        path.join(dir, ".env"),
        "ANALYTICS_DATABASE_URL=postgres://shared\nSHARED_ONLY=from-env\n",
      );
      fs.writeFileSync(
        path.join(dir, ".env.local"),
        "ANALYTICS_DATABASE_URL=postgres://local\nANALYTICS_SECRETS_ENCRYPTION_KEY=local-key\nBETTER_AUTH_SECRET=app-auth\n",
      );

      assert.deepEqual(appLocalEnv({ id: "analytics", dir }), {
        ANALYTICS_DATABASE_URL: "postgres://local",
        ANALYTICS_SECRETS_ENCRYPTION_KEY: "local-key",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("dev-lazy canonical loopback origin", () => {
  it("redirects localhost to the advertised 127.0.0.1 origin", () => {
    assert.equal(
      canonicalLoopbackRedirect(
        "localhost:8080",
        "/analytics?tab=dashboards",
        "http://127.0.0.1:8080",
      ),
      "http://127.0.0.1:8080/analytics?tab=dashboards",
    );
  });

  it("redirects 127.0.0.1 when localhost is the advertised origin", () => {
    assert.equal(
      canonicalLoopbackRedirect(
        "127.0.0.1:8080",
        "/analytics",
        "http://localhost:8080",
      ),
      "http://localhost:8080/analytics",
    );
  });

  it("does not redirect an already canonical request", () => {
    assert.equal(
      canonicalLoopbackRedirect(
        "127.0.0.1:8080",
        "/analytics",
        "http://127.0.0.1:8080",
      ),
      undefined,
    );
  });

  it("does not redirect a loopback host on a different port", () => {
    assert.equal(
      canonicalLoopbackRedirect(
        "localhost:8081",
        "/analytics",
        "http://127.0.0.1:8080",
      ),
      undefined,
    );
  });

  it("does not redirect external or forwarded development hosts", () => {
    assert.equal(
      canonicalLoopbackRedirect(
        "workspace.example.test",
        "/analytics",
        "http://127.0.0.1:8080",
      ),
      undefined,
    );
    assert.equal(
      canonicalLoopbackRedirect(
        "localhost:8080",
        "/analytics",
        "https://workspace.example.test",
      ),
      undefined,
    );
  });

  it("rejects malformed hosts and non-origin-form request targets", () => {
    assert.equal(
      canonicalLoopbackRedirect(
        "not a host",
        "/analytics",
        "http://127.0.0.1:8080",
      ),
      undefined,
    );
    assert.equal(
      canonicalLoopbackRedirect(
        "localhost:8080",
        "https://example.test/analytics",
        "http://127.0.0.1:8080",
      ),
      undefined,
    );
  });
});

describe("dev-lazy browser asset classification", () => {
  it("uses the interactive deadline for Vite module and style requests", () => {
    assert.equal(isBrowserAssetDestination("script"), true);
    assert.equal(isBrowserAssetDestination("style"), true);
    assert.equal(isBrowserAssetDestination("worker"), true);
    assert.equal(isBrowserAssetDestination("font"), true);
  });

  it("keeps API requests and document navigations out of the asset deadline", () => {
    assert.equal(isBrowserAssetDestination("empty"), false);
    assert.equal(isBrowserAssetDestination("document"), false);
    assert.equal(isBrowserAssetDestination(undefined), false);
  });

  it("accepts Node's array-shaped header values", () => {
    assert.equal(isBrowserAssetDestination(["SCRIPT"]), true);
  });

  it("keeps long deadlines only for non-browser API traffic", () => {
    const timeouts = { html: 5_000, browserAsset: 15_000, other: 120_000 };
    assert.equal(
      selectProxyResponseTimeout({ html: true, browserAsset: false }, timeouts),
      5_000,
    );
    assert.equal(
      selectProxyResponseTimeout({ html: false, browserAsset: true }, timeouts),
      15_000,
    );
    assert.equal(
      selectProxyResponseTimeout(
        { html: false, browserAsset: false },
        timeouts,
      ),
      120_000,
    );
  });
});

describe("dev-lazy idle eviction", () => {
  it("never evicts an app with an open socket, no matter how quiet", () => {
    assert.equal(
      shouldEvict({
        lastActivityAt: 0,
        openSockets: 1,
        now: 10_000_000,
        idleTimeoutMs: 120_000,
      }),
      false,
    );
  });

  it("evicts once quiet with no open sockets exceeds the idle timeout", () => {
    assert.equal(
      shouldEvict({
        lastActivityAt: 0,
        openSockets: 0,
        now: 120_001,
        idleTimeoutMs: 120_000,
      }),
      true,
    );
  });

  it("does not evict while still within the idle timeout", () => {
    assert.equal(
      shouldEvict({
        lastActivityAt: 0,
        openSockets: 0,
        now: 100_000,
        idleTimeoutMs: 120_000,
      }),
      false,
    );
  });

  it("keeps a long-lived streamed response (SSE) alive the same way a WebSocket upgrade does", () => {
    // dispatch() pins the app by incrementing openSockets for the lifetime of
    // a proxied response (SSE from useDbSync/agent chat included), exactly
    // like proxyUpgrade already did for WebSockets. Even though the request
    // started long ago, an open stream must never look idle to the sweep.
    assert.equal(
      shouldEvict({
        lastActivityAt: 0,
        openSockets: 1,
        now: 10 * 60_000,
        idleTimeoutMs: 120_000,
      }),
      false,
    );
  });

  it("disables eviction entirely when idleTimeoutMs is not positive", () => {
    assert.equal(
      shouldEvict({
        lastActivityAt: 0,
        openSockets: 0,
        now: 10_000_000,
        idleTimeoutMs: 0,
      }),
      false,
    );
  });
});

describe("dev-lazy stuck-app restart decision", () => {
  it("always restarts when the port has stopped accepting connections", () => {
    assert.equal(
      shouldRestartStuckApp({
        portOpen: false,
        lastNon5xxAt: Date.now(),
        now: Date.now(),
        stuckMs: 300_000,
      }),
      true,
    );
  });

  it("waits instead of restarting while the port is open and within the stuck window", () => {
    // This is the "still optimizing deps / rebuilding" case: killing here
    // would discard warm caches and restart the optimize pass from scratch.
    const now = 1_000_000;
    assert.equal(
      shouldRestartStuckApp({
        portOpen: true,
        lastNon5xxAt: now - 60_000,
        now,
        stuckMs: 300_000,
      }),
      false,
    );
  });

  it("escalates to a restart once an open port has produced no healthy response for the stuck window", () => {
    const now = 1_000_000;
    assert.equal(
      shouldRestartStuckApp({
        portOpen: true,
        lastNon5xxAt: now - 300_001,
        now,
        stuckMs: 300_000,
      }),
      true,
    );
  });
});

describe("dev-lazy persistent-5xx restart decision", () => {
  it("does not restart while a recent non-5xx response exists", () => {
    const now = 1_000_000;
    assert.equal(
      shouldRestartPersistent5xx({
        lastNon5xxAt: now - 1_000,
        now,
        restartMs: 75_000,
      }),
      false,
    );
  });

  it("restarts once the app has served nothing but 5xx for the full restart window", () => {
    // Mirrors Nitro's dev env-runner getting stuck serving 503 forever after
    // a few worker crashes.
    const now = 1_000_000;
    assert.equal(
      shouldRestartPersistent5xx({
        lastNon5xxAt: now - 75_001,
        now,
        restartMs: 75_000,
      }),
      true,
    );
  });
});

describe("dev-lazy backoff reset on ready", () => {
  const makeApp = (
    overrides: Partial<{
      ready: boolean;
      restartAttempts: number;
      lastNon5xxAt: number;
    }> = {},
  ) => ({
    id: "test-app",
    name: "Test App",
    description: "",
    dir: "/tmp/test-app",
    port: 34_567,
    core: false,
    ready: false,
    restartAttempts: 3,
    ...overrides,
  });

  it("marks the app ready, stamps lastNon5xxAt, and clears restartAttempts", () => {
    // Backoff must only reset on an actual successful serve — not on a fixed
    // post-spawn timer — or an app that always fails between 5s and 30s
    // would never escalate its retry delay.
    const app = makeApp({ restartAttempts: 5 });
    const before = Date.now();
    markAppReady(app);
    assert.equal(app.ready, true);
    assert.equal(app.restartAttempts, 0);
    assert.ok(app.lastNon5xxAt !== undefined && app.lastNon5xxAt >= before);
  });
});
