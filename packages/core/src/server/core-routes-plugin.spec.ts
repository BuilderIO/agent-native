import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { H3Event } from "h3";
import {
  resolveBuilderOwnerContextForRequest,
  resolveBuilderWaitlistFormTargetForRequest,
  resolveFrameworkSseRoutes,
  resolveLegacyToolsRedirect,
  AVATAR_RASTER_MIME,
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

describe("resolveFrameworkSseRoutes", () => {
  it("mounts the default and legacy SSE routes", () => {
    expect(resolveFrameworkSseRoutes()).toEqual([
      "/_agent-native/events",
      "/_agent-native/poll-events",
    ]);
  });

  it("keeps custom SSE routes while preserving compatibility aliases", () => {
    expect(resolveFrameworkSseRoutes("/_agent-native/sse")).toEqual([
      "/_agent-native/sse",
      "/_agent-native/events",
      "/_agent-native/poll-events",
    ]);
  });

  it("deduplicates when the custom route is already a compatibility route", () => {
    expect(resolveFrameworkSseRoutes("/_agent-native/poll-events")).toEqual([
      "/_agent-native/poll-events",
      "/_agent-native/events",
    ]);
  });
});

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

describe("resolveBuilderWaitlistFormTargetForRequest", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it("uses the Builder-org waitlist form on hosted Agent Native domains", () => {
    const event = createMockEvent(
      "https://forms.agent-native.com/_agent-native/builder/branch-waitlist",
    );

    expect(resolveBuilderWaitlistFormTargetForRequest(event)).toEqual({
      formId: "DYTHuM0jlV",
      formsOrigin: "https://forms.agent-native.com",
    });
  });

  it("does not submit local waitlist clicks to the hosted form by default", () => {
    const event = createMockEvent(
      "http://localhost:8080/_agent-native/builder/branch-waitlist",
    );

    expect(resolveBuilderWaitlistFormTargetForRequest(event)).toBeNull();
  });

  it("allows self-hosted deployments to opt into a form target explicitly", () => {
    process.env.AGENT_NATIVE_BUILDER_WAITLIST_FORM_ID = "custom-form";
    process.env.AGENT_NATIVE_BUILDER_WAITLIST_FORMS_ORIGIN =
      "https://forms.example.com/path";
    const event = createMockEvent(
      "https://app.example.com/_agent-native/builder/branch-waitlist",
    );

    expect(resolveBuilderWaitlistFormTargetForRequest(event)).toEqual({
      formId: "custom-form",
      formsOrigin: "https://forms.example.com",
    });
  });
});

describe("AVATAR_RASTER_MIME", () => {
  // Accepted raster types
  it("accepts data:image/png", () => {
    expect(AVATAR_RASTER_MIME.test("data:image/png;base64,iVBORw0KGgo=")).toBe(
      true,
    );
  });

  it("accepts data:image/jpeg", () => {
    expect(AVATAR_RASTER_MIME.test("data:image/jpeg;base64,/9j/4AA=")).toBe(
      true,
    );
  });

  it("accepts data:image/jpg alias", () => {
    expect(AVATAR_RASTER_MIME.test("data:image/jpg;base64,/9j/4AA=")).toBe(
      true,
    );
  });

  it("accepts data:image/gif", () => {
    expect(AVATAR_RASTER_MIME.test("data:image/gif;base64,R0lGODlh")).toBe(
      true,
    );
  });

  it("accepts data:image/webp", () => {
    expect(AVATAR_RASTER_MIME.test("data:image/webp;base64,UklGRg==")).toBe(
      true,
    );
  });

  // Rejected types — SVG is the primary stored-XSS vector
  it("rejects data:image/svg+xml (stored-XSS risk)", () => {
    expect(
      AVATAR_RASTER_MIME.test(
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=",
      ),
    ).toBe(false);
  });

  it("rejects data:image/svg+xml with raw content", () => {
    expect(
      AVATAR_RASTER_MIME.test(
        "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
      ),
    ).toBe(false);
  });

  it("rejects data:text/html", () => {
    expect(AVATAR_RASTER_MIME.test("data:text/html,<h1>hi</h1>")).toBe(false);
  });

  it("rejects https:// URLs (not a data URI)", () => {
    expect(AVATAR_RASTER_MIME.test("https://example.com/avatar.png")).toBe(
      false,
    );
  });

  it("rejects a plain data:image/ prefix with no subtype", () => {
    expect(AVATAR_RASTER_MIME.test("data:image/")).toBe(false);
  });
});
