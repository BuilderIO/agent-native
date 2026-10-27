import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  getHeader: (event: any, name: string) => event._headers?.[name.toLowerCase()],
}));

import { devLoopbackAuthHint } from "./dev-origin-hint.js";

function event(headers: Record<string, string>) {
  return { _headers: headers } as any;
}

describe("devLoopbackAuthHint", () => {
  it("names the canonical localhost origin and the visited label for the origin-label flip", () => {
    const hint = devLoopbackAuthHint(
      event({ host: "127.0.0.1:8082" }),
      "http://localhost:8082",
    );
    expect(hint).toContain("http://127.0.0.1:8082");
    expect(hint).toContain("http://localhost:8082");
    expect(hint).not.toMatch(/\r|\n/);
  });

  it("keeps the visited port when naming the canonical origin", () => {
    const hint = devLoopbackAuthHint(
      event({ host: "[::1]:8090" }),
      "http://127.0.0.1:8090",
    );
    expect(hint).toContain("http://127.0.0.1:8090");
    expect(hint).toContain("http://[::1]:8090");
  });

  it("falls back to a sign-in-again line when the visitor is already on the canonical label", () => {
    const hint = devLoopbackAuthHint(
      event({ host: "localhost:8081" }),
      "http://localhost:8081",
    );
    expect(hint).toContain("http://localhost:8081");
    expect(hint).not.toContain("127.0.0.1");
  });

  it("never throws on a missing or malformed Host header", () => {
    for (const headers of [{}, { host: "" }, { host: "not a host" }]) {
      const hint = devLoopbackAuthHint(event(headers), "http://localhost:8081");
      expect(typeof hint).toBe("string");
      expect(hint).not.toMatch(/\r|\n/);
    }
  });

  it("uses https when the request arrived over a forwarded https hop", () => {
    const hint = devLoopbackAuthHint(
      event({ host: "127.0.0.1:8082", "x-forwarded-proto": "https" }),
      "https://localhost:8082",
    );
    expect(hint).toContain("https://localhost:8082");
    expect(hint).not.toContain("http://localhost:8082");
  });

  it("uses the canonical HTTPS protocol for a direct request without proxy headers", () => {
    const hint = devLoopbackAuthHint(
      event({ host: "localhost:8083" }),
      "https://localhost:8083",
    );
    expect(hint).toContain("https://localhost:8083");
    expect(hint).not.toContain("http://localhost:8083");
    expect(hint).toContain("sign in again on this origin");
  });

  it("carries no session token or user data", () => {
    const hint = devLoopbackAuthHint(
      event({
        host: "127.0.0.1:8082",
        cookie: "an_session=secret-token; an_session_hint=1",
        "x-agent-native-dev-user": "owner@example.test",
      }),
      "http://localhost:8082",
    );
    expect(hint).not.toContain("secret-token");
    expect(hint).not.toContain("owner@example.test");
  });

  it("uses the recorded IPv6 origin instead of inventing localhost", () => {
    const hint = devLoopbackAuthHint(
      event({ host: "localhost:8084" }),
      "http://[::1]:8084",
    );
    expect(hint).toContain("http://[::1]:8084");
    expect(hint).not.toContain("canonical origin is http://localhost:8084");
  });

  it("stays generic until the recorded canonical origin is available", () => {
    const hint = devLoopbackAuthHint(
      event({ host: "127.0.0.1:8082" }),
      undefined,
    );
    expect(hint).toContain("the origin the dev server printed");
    expect(hint).not.toContain("canonical origin is");
  });

  it("stays generic for an invalid or non-loopback recorded origin", () => {
    for (const canonicalOrigin of [
      "not a URL",
      "https://example.com",
      "http://localhost:8082/path",
    ]) {
      const hint = devLoopbackAuthHint(
        event({ host: "127.0.0.1:8082" }),
        canonicalOrigin,
      );
      expect(hint).toContain("the origin the dev server printed");
      expect(hint).not.toContain(canonicalOrigin);
    }
  });
});

describe("auth guard hint gate", () => {
  it("emits the hint only for dev, loopback, /_agent-native/* 401s", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "auth.ts"),
      "utf8",
    );
    const index = source.indexOf("devLoopbackAuthHint(");
    expect(index).toBeGreaterThan(-1);
    expect(source).toContain('from "./dev-action-discovery.js"');
    expect(source).not.toContain('from "./dev-action-bridge.js"');
    const gate = source.slice(Math.max(0, index - 500), index);
    expect(gate).toContain('p.startsWith("/_agent-native/")');
    expect(gate).toContain("isDevEnvironment()");
    expect(gate).toContain("isLoopbackRequest(event)");
    const after = source.slice(index, index + 300);
    expect(after).toContain('{ error: "Unauthorized", hint }');
  });
});
