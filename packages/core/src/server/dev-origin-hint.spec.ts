import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

// Same mocking shape as dev-action-bridge.spec.ts: a fake h3 event is a plain
// object with a `_headers` record, and `getHeader` reads it case-insensitively.
vi.mock("h3", () => ({
  getHeader: (event: any, name: string) => event._headers?.[name.toLowerCase()],
}));

import { devLoopbackAuthHint } from "./dev-origin-hint.js";

function event(headers: Record<string, string>) {
  return { _headers: headers } as any;
}

describe("devLoopbackAuthHint", () => {
  it("names the canonical localhost origin and the visited label for the origin-label flip", () => {
    const hint = devLoopbackAuthHint(event({ host: "127.0.0.1:8082" }));
    expect(hint).toContain("http://127.0.0.1:8082");
    expect(hint).toContain("http://localhost:8082");
    expect(hint).not.toMatch(/\r|\n/);
  });

  it("keeps the visited port when naming the canonical origin", () => {
    const hint = devLoopbackAuthHint(event({ host: "[::1]:8090" }));
    expect(hint).toContain("http://localhost:8090");
    expect(hint).toContain("http://[::1]:8090");
  });

  it("falls back to a sign-in-again line when the visitor is already on the canonical label", () => {
    const hint = devLoopbackAuthHint(event({ host: "localhost:8081" }));
    expect(hint).toContain("http://localhost:8081");
    expect(hint).not.toContain("127.0.0.1");
  });

  it("never throws on a missing or malformed Host header", () => {
    for (const headers of [{}, { host: "" }, { host: "not a host" }]) {
      const hint = devLoopbackAuthHint(event(headers));
      expect(typeof hint).toBe("string");
      expect(hint).not.toMatch(/\r|\n/);
    }
  });

  it("uses https when the request arrived over a forwarded https hop", () => {
    const hint = devLoopbackAuthHint(
      event({ host: "127.0.0.1:8082", "x-forwarded-proto": "https" }),
    );
    expect(hint).toContain("https://localhost:8082");
    expect(hint).not.toContain("http://localhost:8082");
  });

  it("carries no session token or user data", () => {
    const hint = devLoopbackAuthHint(
      event({
        host: "127.0.0.1:8082",
        cookie: "an_session=secret-token; an_session_hint=1",
        "x-agent-native-dev-user": "owner@example.test",
      }),
    );
    expect(hint).not.toContain("secret-token");
    expect(hint).not.toContain("owner@example.test");
  });
});

describe("auth guard hint gate", () => {
  // Driving the full auth guard needs better-auth, db, and app-config; the
  // established contract shape for this guard is the source-contract test in
  // dev-action-bridge.spec.ts. Assert the hint branch stays gated on dev +
  // loopback and scoped to /_agent-native/*, so it cannot leak into /api/* or
  // production responses.
  it("emits the hint only for dev, loopback, /_agent-native/* 401s", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "auth.ts"),
      "utf8",
    );
    const index = source.indexOf("devLoopbackAuthHint(event)");
    expect(index).toBeGreaterThan(-1);
    const gate = source.slice(Math.max(0, index - 500), index);
    expect(gate).toContain('p.startsWith("/_agent-native/")');
    expect(gate).toContain("isDevEnvironment()");
    expect(gate).toContain("isLoopbackRequest(event)");
    const after = source.slice(index, index + 200);
    expect(after).toContain('{ error: "Unauthorized", hint }');
  });
});
