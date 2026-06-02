import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { H3Event } from "h3";
import {
  resolveBuilderOwnerContextForRequest,
  resolveLegacyToolsRedirect,
} from "./core-routes-plugin.js";
import {
  BUILDER_CONNECT_PARAM,
  BUILDER_STATE_PARAM,
  signBuilderCallbackState,
  signBuilderConnectToken,
} from "./builder-browser.js";

function createMockEvent(url: string): H3Event {
  const parsed = new URL(url);
  return {
    req: {
      method: "GET",
      url: parsed.href,
      headers: new Headers({ host: parsed.host }),
    },
    url: parsed,
    node: {
      req: {
        headers: { host: parsed.host },
        method: "GET",
        url: `${parsed.pathname}${parsed.search}`,
      },
    },
    headers: new Headers({ host: parsed.host }),
    context: {},
    path: parsed.pathname,
  } as unknown as H3Event;
}

describe("resolveLegacyToolsRedirect", () => {
  afterEach(() => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
  });

  it("redirects /tools to /extensions", () => {
    expect(resolveLegacyToolsRedirect("/tools", "")).toBe("/extensions");
  });

  it("redirects /tools/<id> to /extensions/<id>", () => {
    expect(resolveLegacyToolsRedirect("/tools/abc-123", "")).toBe(
      "/extensions/abc-123",
    );
  });

  it("preserves query strings", () => {
    expect(resolveLegacyToolsRedirect("/tools/abc", "?foo=bar")).toBe(
      "/extensions/abc?foo=bar",
    );
  });

  it("redirects nested /tools/<id>/something paths", () => {
    expect(resolveLegacyToolsRedirect("/tools/abc/edit", "")).toBe(
      "/extensions/abc/edit",
    );
  });

  it("redirects under APP_BASE_PATH (workspace deploy)", () => {
    process.env.APP_BASE_PATH = "/dispatch";
    expect(resolveLegacyToolsRedirect("/dispatch/tools/abc", "")).toBe(
      "/dispatch/extensions/abc",
    );
  });

  it("redirects /tools under APP_BASE_PATH with no id", () => {
    process.env.APP_BASE_PATH = "/dispatch";
    expect(resolveLegacyToolsRedirect("/dispatch/tools", "?x=1")).toBe(
      "/dispatch/extensions?x=1",
    );
  });

  it("returns null for /_agent-native/tools (API namespace)", () => {
    expect(resolveLegacyToolsRedirect("/_agent-native/tools", "")).toBeNull();
    expect(
      resolveLegacyToolsRedirect("/_agent-native/tools/abc", ""),
    ).toBeNull();
  });

  it("returns null for unrelated paths", () => {
    expect(resolveLegacyToolsRedirect("/extensions", "")).toBeNull();
    expect(resolveLegacyToolsRedirect("/extensions/abc", "")).toBeNull();
    expect(resolveLegacyToolsRedirect("/", "")).toBeNull();
    expect(resolveLegacyToolsRedirect("/inbox", "")).toBeNull();
  });

  it("does not match /toolsuffix or /tools-foo (must be exact or have / separator)", () => {
    expect(resolveLegacyToolsRedirect("/toolsfoo", "")).toBeNull();
    expect(resolveLegacyToolsRedirect("/tools-x", "")).toBeNull();
  });

  it("falls through when path is outside APP_BASE_PATH", () => {
    process.env.APP_BASE_PATH = "/dispatch";
    // /tools without the /dispatch prefix is outside this app's base path,
    // so stripAppBasePath leaves it unchanged and the helper still matches.
    // The redirect target is built relative to the configured base path.
    expect(resolveLegacyToolsRedirect("/tools/abc", "")).toBe(
      "/dispatch/extensions/abc",
    );
  });

  it("VITE_APP_BASE_PATH wins over APP_BASE_PATH", () => {
    process.env.VITE_APP_BASE_PATH = "/mail";
    process.env.APP_BASE_PATH = "/ignored";
    expect(resolveLegacyToolsRedirect("/mail/tools/abc", "")).toBe(
      "/mail/extensions/abc",
    );
  });
});

describe("resolveBuilderOwnerContextForRequest", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "builder-owner-context-test-secret";
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it("uses signed callback state when docs auth minted a fresh anonymous session", async () => {
    const originalOwner = "anon-original@agent-native.com";
    const freshOwner = "anon-fresh@agent-native.com";
    const state = signBuilderCallbackState(originalOwner);
    const event = createMockEvent(
      `https://agent-native.com/_agent-native/builder/callback?${BUILDER_STATE_PARAM}=${encodeURIComponent(state)}`,
    );

    const context = await resolveBuilderOwnerContextForRequest(
      event,
      {
        getSessionForEvent: async () => ({ email: freshOwner }),
      },
      "callback",
    );

    expect(context.email).toBe(originalOwner);
    expect(context.session).toBeNull();
    expect(context.anonymous).toBe(true);
  });

  it("uses signed connect owner when docs auth minted a fresh anonymous session", async () => {
    const originalOwner = "anon-original@agent-native.com";
    const freshOwner = "anon-fresh@agent-native.com";
    const token = signBuilderConnectToken(originalOwner);
    const event = createMockEvent(
      `https://agent-native.com/_agent-native/builder/connect?${BUILDER_CONNECT_PARAM}=${encodeURIComponent(token)}`,
    );

    const context = await resolveBuilderOwnerContextForRequest(
      event,
      {
        getSessionForEvent: async () => ({ email: freshOwner }),
      },
      "connect",
    );

    expect(context.email).toBe(originalOwner);
    expect(context.session).toBeNull();
    expect(context.anonymous).toBe(true);
  });

  it("does not let signed Builder state override a different real user session", async () => {
    const state = signBuilderCallbackState("mallory@example.com");
    const event = createMockEvent(
      `https://assets.agent-native.com/_agent-native/builder/callback?${BUILDER_STATE_PARAM}=${encodeURIComponent(state)}`,
    );

    const context = await resolveBuilderOwnerContextForRequest(
      event,
      {
        getSessionForEvent: async () => ({ email: "steve@builder.io" }),
      },
      "callback",
    );

    expect(context.email).toBe("steve@builder.io");
    expect(context.session).toEqual({ email: "steve@builder.io" });
    expect(context.anonymous).toBe(false);
  });
});
