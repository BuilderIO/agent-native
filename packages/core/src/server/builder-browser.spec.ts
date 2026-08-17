import type { H3Event } from "h3";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const resolverMocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  resolveSecret: vi.fn(),
}));

vi.mock("../settings/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settings/store.js")>();
  return {
    ...actual,
    getSetting: (...args: unknown[]) => resolverMocks.getSetting(...args),
  };
});

vi.mock("./request-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./request-context.js")>();
  return {
    ...actual,
    getRequestOrgId: () => resolverMocks.getRequestOrgId(),
    getRequestUserEmail: () => resolverMocks.getRequestUserEmail(),
  };
});

vi.mock("./credential-provider.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./credential-provider.js")>();
  return {
    ...actual,
    resolveSecret: (...args: unknown[]) => resolverMocks.resolveSecret(...args),
  };
});

import {
  appendBuilderConnectToken,
  buildBuilderCliAuthUrl,
  BUILDER_AGENT_NATIVE_APP_PARAM,
  BUILDER_AGENT_NATIVE_CONNECT_SOURCE_PARAM,
  BUILDER_AGENT_NATIVE_FLOW_PARAM,
  BUILDER_AGENT_NATIVE_TEMPLATE_PARAM,
  BUILDER_CALLBACK_PATH,
  BUILDER_CONNECT_PARAM,
  BUILDER_RELAY_FLOW_HEADER,
  BUILDER_RELAY_SECRET_ENV,
  BUILDER_RELAY_SIGNATURE_HEADER,
  BUILDER_RELAY_TIMESTAMP_HEADER,
  BUILDER_SIGNUP_SOURCE_PARAM,
  BUILDER_STATE_PARAM,
  createBuilderProject,
  createBuilderRelayRequest,
  findBuilderProjectForRepo,
  getBuilderBranchProjectId,
  getBuilderCliAuthCallbackOriginForEvent,
  resolveBuilderCliAuthCallbackTargetForEvent,
  getBuilderBrowserConnectUrl,
  getBuilderBrowserConnectUrlForOwner,
  getBuilderBrowserOriginForEvent,
  getBuilderBrowserStatusForEvent,
  isBuilderBranchingEnabled,
  resolveBuilderCallbackReturnUrl,
  resolveBuilderPreviewRelayParentOrigin,
  resolveBuilderPreviewRelayTargetOrigin,
  resolveBuilderBranchProjectId,
  runBuilderAgent,
  signBuilderConnectToken,
  signBuilderCallbackState,
  signBuilderPreviewRelayState,
  verifyBuilderConnectToken,
  verifyBuilderCallbackState,
  verifyBuilderCallbackStateAndGetOwner,
  verifyBuilderConnectTokenAndGetOwner,
  verifyBuilderRelayRequest,
  type BuilderRelayCredentials,
} from "./builder-browser.js";

function createBuilderBrowserEvent(headers: Record<string, string>): H3Event {
  const requestHeaders = new Headers(headers);
  return {
    req: {
      method: "GET",
      url: "https://agent-workspace.builder.io/_agent-native/builder/status",
      headers: requestHeaders,
    },
    url: new URL(
      "https://agent-workspace.builder.io/_agent-native/builder/status",
    ),
    res: {
      headers: new Headers(),
      status: 200,
    },
    node: {
      req: {
        headers,
        url: "/_agent-native/builder/status",
        method: "GET",
      },
    },
    headers: requestHeaders,
    context: {},
    path: "/_agent-native/builder/status",
  } as unknown as H3Event;
}

const PUBLIC_ORIGIN_ENV_KEYS = [
  "APP_URL",
  "VITE_APP_URL",
  "BETTER_AUTH_URL",
  "VITE_BETTER_AUTH_URL",
  "WORKSPACE_GATEWAY_URL",
  "VITE_WORKSPACE_GATEWAY_URL",
  "FUSION_ENV_ORIGIN",
  "VITE_FUSION_ENV_ORIGIN",
] as const;

describe("Builder callback CSRF state", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Pin the secret so signed tokens are stable across calls and the
    // .env.local autogeneration in resolveAuthSecret never fires.
    process.env.BETTER_AUTH_SECRET = "test-secret-9f2a7c";
    // Fusion/dev containers export a loopback BETTER_AUTH_URL, which would
    // otherwise win the origin allowlist and mask what each case configures.
    for (const key of PUBLIC_ORIGIN_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("signBuilderCallbackState / verifyBuilderCallbackState", () => {
    it("verifies a fresh, well-formed token bound to the same email", () => {
      const token = signBuilderCallbackState("alice@example.com");
      expect(verifyBuilderCallbackState(token, "alice@example.com")).toBe(true);
    });

    it("produces a 4-segment dotted token (nonce.email.ts.mac)", () => {
      const token = signBuilderCallbackState("alice@example.com");
      expect(token.split(".")).toHaveLength(4);
    });

    it("yields different tokens on repeat calls (nonce randomness)", () => {
      const a = signBuilderCallbackState("alice@example.com");
      const b = signBuilderCallbackState("alice@example.com");
      expect(a).not.toBe(b);
    });

    it("rejects an empty / null / non-string token", () => {
      expect(verifyBuilderCallbackState(null, "alice@example.com")).toBe(false);
      expect(verifyBuilderCallbackState(undefined, "alice@example.com")).toBe(
        false,
      );
      expect(verifyBuilderCallbackState("", "alice@example.com")).toBe(false);
    });

    it("rejects a malformed token (wrong segment count)", () => {
      expect(
        verifyBuilderCallbackState("only.three.segments", "alice@example.com"),
      ).toBe(false);
      expect(
        verifyBuilderCallbackState(
          "five.segments.are.too.many",
          "alice@example.com",
        ),
      ).toBe(false);
    });

    it("rejects a token whose MAC was tampered with", () => {
      const token = signBuilderCallbackState("alice@example.com");
      const parts = token.split(".");
      parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith("A") ? "B" : "A");
      const tampered = parts.join(".");
      expect(verifyBuilderCallbackState(tampered, "alice@example.com")).toBe(
        false,
      );
    });

    it("rejects a token signed for a different email (cross-session replay)", () => {
      const aliceToken = signBuilderCallbackState("alice@example.com");
      expect(verifyBuilderCallbackState(aliceToken, "bob@example.com")).toBe(
        false,
      );
    });

    it("rejects a token whose embedded email was swapped post-sign", () => {
      // Forge attempt: keep the MAC but swap the encoded email field.
      const token = signBuilderCallbackState("alice@example.com");
      const [nonce, _emailEncoded, ts, mac] = token.split(".");
      const swappedEmail = Buffer.from("bob@example.com", "utf8").toString(
        "base64url",
      );
      const forged = `${nonce}.${swappedEmail}.${ts}.${mac}`;
      expect(verifyBuilderCallbackState(forged, "bob@example.com")).toBe(false);
    });

    it("rejects a token signed with a different secret (cross-deploy replay)", () => {
      const token = signBuilderCallbackState("alice@example.com");
      process.env.BETTER_AUTH_SECRET = "rotated-secret";
      expect(verifyBuilderCallbackState(token, "alice@example.com")).toBe(
        false,
      );
    });

    it("rejects an expired token (older than 10 min)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
      const token = signBuilderCallbackState("alice@example.com");
      // 11 minutes later — past the 10-min TTL.
      vi.setSystemTime(new Date("2026-04-24T12:11:00.000Z"));
      expect(verifyBuilderCallbackState(token, "alice@example.com")).toBe(
        false,
      );
    });

    it("accepts a token within the TTL window", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
      const token = signBuilderCallbackState("alice@example.com");
      // 9 minutes later — still inside the 10-min TTL.
      vi.setSystemTime(new Date("2026-04-24T12:09:00.000Z"));
      expect(verifyBuilderCallbackState(token, "alice@example.com")).toBe(true);
    });

    it("extracts the owner email from a valid callback state", () => {
      const token = signBuilderCallbackState("alice@example.com");

      expect(verifyBuilderCallbackStateAndGetOwner(token)).toBe(
        "alice@example.com",
      );
    });

    it("rejects a token whose timestamp is far in the future", () => {
      const token = signBuilderCallbackState("alice@example.com");
      const [nonce, email, _ts, mac] = token.split(".");
      // Pretend the token was minted an hour from now — an attacker
      // trying to give a leaked state arbitrary lifetime.
      const futureTs = Date.now() + 60 * 60 * 1000;
      const forged = `${nonce}.${email}.${futureTs}.${mac}`;
      expect(verifyBuilderCallbackState(forged, "alice@example.com")).toBe(
        false,
      );
    });

    it("rejects a token with a non-numeric timestamp", () => {
      const token = signBuilderCallbackState("alice@example.com");
      const [nonce, email, _ts, mac] = token.split(".");
      const forged = `${nonce}.${email}.notanumber.${mac}`;
      expect(verifyBuilderCallbackState(forged, "alice@example.com")).toBe(
        false,
      );
    });

    it("handles emails with special characters (plus addressing, subdomains)", () => {
      const emails = [
        "user+tag@example.com",
        "bob@subdomain.example.co.uk",
        "name@xn--e1afmapc.xn--p1ai",
      ];
      for (const email of emails) {
        const token = signBuilderCallbackState(email);
        expect(verifyBuilderCallbackState(token, email)).toBe(true);
      }
    });

    it("rejects a token when session email differs only by case", () => {
      const token = signBuilderCallbackState("Alice@Example.com");
      expect(verifyBuilderCallbackState(token, "alice@example.com")).toBe(
        false,
      );
    });

    it("works with the AUTH_MODE=local bypass email", () => {
      const token = signBuilderCallbackState("local@localhost");
      expect(verifyBuilderCallbackState(token, "local@localhost")).toBe(true);
    });
  });

  describe("signBuilderConnectToken / verifyBuilderConnectToken", () => {
    it("verifies a fresh token bound to the same owner email", () => {
      const token = signBuilderConnectToken("alice@example.com");
      expect(verifyBuilderConnectToken(token, "alice@example.com")).toBe(true);
    });

    it("rejects a token signed for a different owner email", () => {
      const token = signBuilderConnectToken("alice@example.com");
      expect(verifyBuilderConnectToken(token, "bob@example.com")).toBe(false);
    });

    it("keeps connect tokens separate from callback state tokens", () => {
      const callbackToken = signBuilderCallbackState("alice@example.com");
      expect(
        verifyBuilderConnectToken(callbackToken, "alice@example.com"),
      ).toBe(false);
    });

    it("rejects expired connect tokens", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
      const token = signBuilderConnectToken("alice@example.com");
      vi.setSystemTime(new Date("2026-04-24T12:11:00.000Z"));
      expect(verifyBuilderConnectToken(token, "alice@example.com")).toBe(false);
    });

    it("appends a verifiable connect token to the surfaced URL", () => {
      const connectUrl = appendBuilderConnectToken(
        "https://alice.agent-native.com/_agent-native/builder/connect",
        "alice@example.com",
      );
      const token = new URL(connectUrl).searchParams.get(BUILDER_CONNECT_PARAM);
      expect(token).toBeTruthy();
      expect(verifyBuilderConnectToken(token, "alice@example.com")).toBe(true);
    });

    it("extracts the owner email from a valid connect token", () => {
      const token = signBuilderConnectToken("alice@example.com");

      expect(verifyBuilderConnectTokenAndGetOwner(token)).toBe(
        "alice@example.com",
      );
    });

    it("does not extract an owner from a forged connect token", () => {
      const token = signBuilderConnectToken("alice@example.com");
      const parts = token.split(".");
      parts[1] = Buffer.from("bob@example.com", "utf8").toString("base64url");

      expect(verifyBuilderConnectTokenAndGetOwner(parts.join("."))).toBeNull();
    });

    it("builds an owner-signed connect URL for server-rendered cards", () => {
      const connectUrl = getBuilderBrowserConnectUrlForOwner(
        "https://alice.agent-native.com",
        "alice@example.com",
      );
      const parsed = new URL(connectUrl);
      const token = parsed.searchParams.get(BUILDER_CONNECT_PARAM);

      expect(parsed.pathname).toBe("/_agent-native/builder/connect");
      expect(token).toBeTruthy();
      expect(verifyBuilderConnectTokenAndGetOwner(token)).toBe(
        "alice@example.com",
      );
    });
  });

  describe("buildBuilderCliAuthUrl", () => {
    // The callback state is optional because legacy /builder/connect clients
    // can still rely on the server-side pending-connect row. New clients get a
    // ready-to-open /cli-auth URL from /builder/status with _an_state embedded
    // in redirect_url so the popup can skip the app trampoline entirely.
    it("builds a clean redirect_url (no _an_state) when state is null", () => {
      const cliAuthUrl = buildBuilderCliAuthUrl(
        "https://alice.agent-native.com",
        null,
      );
      const parsed = new URL(cliAuthUrl);
      const redirectUrl = parsed.searchParams.get("redirect_url");
      expect(redirectUrl).toBeTruthy();
      const parsedRedirect = new URL(redirectUrl!);
      expect(parsedRedirect.pathname).toBe(BUILDER_CALLBACK_PATH);
      // No _an_state — Builder can safely append its own params.
      expect(parsedRedirect.searchParams.has(BUILDER_STATE_PARAM)).toBe(false);
    });

    it("Builder can append p-key/api-key to a clean redirect_url", () => {
      const cliAuthUrl = buildBuilderCliAuthUrl(
        "https://alice.agent-native.com",
        null,
      );
      const redirectUrl = new URL(cliAuthUrl).searchParams.get("redirect_url")!;
      const finalUrl = new URL(redirectUrl);
      finalUrl.searchParams.set("p-key", "bpk-test-private-key");
      finalUrl.searchParams.set("api-key", "test-api-key");
      finalUrl.searchParams.set("user-id", "user-123");
      finalUrl.searchParams.set("org-name", "Acme");
      finalUrl.searchParams.set("kind", "team");
      // State param is absent — callback authenticates via server-side row.
      expect(finalUrl.searchParams.has(BUILDER_STATE_PARAM)).toBe(false);
      expect(finalUrl.searchParams.get("p-key")).toBe("bpk-test-private-key");
      expect(finalUrl.searchParams.get("api-key")).toBe("test-api-key");
    });

    it("still supports an optional state param for legacy/testing use", () => {
      const state = signBuilderCallbackState("alice@example.com");
      const cliAuthUrl = buildBuilderCliAuthUrl(
        "https://alice.agent-native.com",
        state,
      );
      const parsed = new URL(cliAuthUrl);
      const redirectUrl = parsed.searchParams.get("redirect_url");
      expect(redirectUrl).toBeTruthy();
      const parsedRedirect = new URL(redirectUrl!);
      expect(parsedRedirect.searchParams.get(BUILDER_STATE_PARAM)).toBe(state);
    });

    it("omits the state param when no state is provided", () => {
      const cliAuthUrl = buildBuilderCliAuthUrl(
        "https://alice.agent-native.com",
      );
      const redirectUrl = new URL(cliAuthUrl).searchParams.get("redirect_url")!;
      expect(new URL(redirectUrl).searchParams.has(BUILDER_STATE_PARAM)).toBe(
        false,
      );
    });

    it("normalizes a trailing slash in the origin", () => {
      const cliAuthUrl = buildBuilderCliAuthUrl(
        "https://alice.agent-native.com/",
      );
      const redirectUrl = new URL(cliAuthUrl).searchParams.get("redirect_url")!;
      const parsedRedirect = new URL(redirectUrl);
      expect(parsedRedirect.origin).toBe("https://alice.agent-native.com");
      expect(parsedRedirect.pathname).toBe(BUILDER_CALLBACK_PATH);
      expect(parsedRedirect.searchParams.get(BUILDER_SIGNUP_SOURCE_PARAM)).toBe(
        "agent-native",
      );
    });

    it("preserves APP_BASE_PATH in redirect and preview URLs", () => {
      process.env.APP_BASE_PATH = "/docs/";
      const cliAuthUrl = buildBuilderCliAuthUrl(
        "https://alice.agent-native.com/",
      );
      const parsed = new URL(cliAuthUrl);
      const redirectUrl = parsed.searchParams.get("redirect_url");
      expect(redirectUrl).toBeTruthy();
      const parsedRedirect = new URL(redirectUrl!);
      expect(parsedRedirect.origin).toBe("https://alice.agent-native.com");
      expect(parsedRedirect.pathname).toBe(
        "/docs/_agent-native/builder/callback",
      );
      expect(parsed.searchParams.get("preview_url")).toBe(
        "https://alice.agent-native.com/docs",
      );
    });

    it("adds Agent Native signup attribution to cli-auth and callback URLs", () => {
      const cliAuthUrl = buildBuilderCliAuthUrl(
        "https://alice.agent-native.com",
        signBuilderCallbackState("alice@example.com"),
        {
          tracking: {
            agentNativeFlow: "background_agent",
            agentNativeConnectSource: "connect_builder_card",
            agentNativeApp: "agent-native-clips",
            agentNativeTemplate: "clips",
          },
        },
      );
      const parsed = new URL(cliAuthUrl);
      const redirectUrl = new URL(parsed.searchParams.get("redirect_url")!);

      for (const params of [parsed.searchParams, redirectUrl.searchParams]) {
        expect(params.get(BUILDER_SIGNUP_SOURCE_PARAM)).toBe("agent-native");
        expect(params.get(BUILDER_AGENT_NATIVE_FLOW_PARAM)).toBe(
          "background_agent",
        );
        expect(params.get(BUILDER_AGENT_NATIVE_CONNECT_SOURCE_PARAM)).toBe(
          "connect_builder_card",
        );
        expect(params.get(BUILDER_AGENT_NATIVE_APP_PARAM)).toBe(
          "agent-native-clips",
        );
        expect(params.get(BUILDER_AGENT_NATIVE_TEMPLATE_PARAM)).toBe("clips");
      }
      expect(parsed.searchParams.get("utm_source")).toBe("agent-native");
      expect(parsed.searchParams.get("utm_medium")).toBe("product");
      expect(parsed.searchParams.get("utm_campaign")).toBe("onboarding");
      expect(parsed.searchParams.get("utm_content")).toBe(
        "connect_builder_card",
      );
      expect(redirectUrl.searchParams.has("utm_source")).toBe(false);
    });

    it("preserves APP_BASE_PATH in the surfaced connect URL", () => {
      process.env.APP_BASE_PATH = "/docs/";
      expect(
        getBuilderBrowserConnectUrl("https://alice.agent-native.com/"),
      ).toBe(
        "https://alice.agent-native.com/docs/_agent-native/builder/connect",
      );
    });

    it("uses a Builder-accepted gateway callback for preview-host cli-auth redirects", () => {
      process.env.NODE_ENV = "production";
      process.env.AGENT_NATIVE_WORKSPACE = "1";
      process.env.APP_URL = "https://agent-workspace.builder.io";
      process.env.WORKSPACE_GATEWAY_URL = "https://agent-workspace.builder.io";
      process.env.APP_BASE_PATH = "/dispatch";

      const event = createBuilderBrowserEvent({
        "x-forwarded-host":
          "940ebc5a83164aa6a37dde445e494f3a-fluid-crack-ctnhvsyb.builderio.xyz",
        "x-forwarded-proto": "https",
      });

      const previewOrigin = getBuilderBrowserOriginForEvent(event);
      const callbackOrigin = getBuilderCliAuthCallbackOriginForEvent(event);
      const cliAuthUrl = buildBuilderCliAuthUrl(
        callbackOrigin,
        signBuilderCallbackState("alice@example.com"),
        { previewOrigin },
      );
      const parsed = new URL(cliAuthUrl);

      expect(callbackOrigin).toBe("https://agent-workspace.builder.io");
      const redirectUrl = parsed.searchParams.get("redirect_url");
      expect(redirectUrl).toContain(
        "https://agent-workspace.builder.io/dispatch/_agent-native/builder/callback",
      );
      // The callback origin (the part Builder validates against its allow-list)
      // must be the gateway, not the preview host.
      expect(new URL(redirectUrl!).origin).toBe(
        "https://agent-workspace.builder.io",
      );
      // The original preview origin must still ride along inside the
      // redirect_url query string so the callback can use it as the
      // postMessage targetOrigin for the opener tab.
      expect(new URL(redirectUrl!).searchParams.get("_an_opener")).toBe(
        "https://940ebc5a83164aa6a37dde445e494f3a-fluid-crack-ctnhvsyb.builderio.xyz",
      );
      expect(parsed.searchParams.get("preview_url")).toBe(
        "https://agent-workspace.builder.io/dispatch",
      );
    });

    it("keeps Builder preview connect URLs on the preview deployment in workspace mode", () => {
      process.env.NODE_ENV = "production";
      process.env.AGENT_NATIVE_WORKSPACE = "1";
      process.env.WORKSPACE_GATEWAY_URL = "https://agent-workspace.builder.io";
      process.env.APP_BASE_PATH = "/dispatch";

      const event = createBuilderBrowserEvent({
        "x-forwarded-host":
          "940ebc5a83164aa6a37dde445e494f3a-fluid-crack-ctnhvsyb.builderio.xyz",
        "x-forwarded-proto": "https",
      });

      expect(getBuilderBrowserStatusForEvent(event).connectUrl).toBe(
        "https://940ebc5a83164aa6a37dde445e494f3a-fluid-crack-ctnhvsyb.builderio.xyz/dispatch/_agent-native/builder/connect",
      );
    });

    it("uses Fusion's public preview origin instead of a loopback gateway for Builder connect", () => {
      process.env.NODE_ENV = "production";
      process.env.AGENT_NATIVE_WORKSPACE = "1";
      process.env.WORKSPACE_GATEWAY_URL = "http://127.0.0.1:8080";
      process.env.FUSION_ENV_ORIGIN =
        "https://940ebc5a83164aa6a37dde445e494f3a-fluid-crack-ctnhvsyb.builderio.xyz";
      process.env.APP_BASE_PATH = "/dispatch";

      const event = createBuilderBrowserEvent({
        "x-forwarded-host": "127.0.0.1:8080",
        "x-forwarded-proto": "http",
      });

      expect(getBuilderBrowserOriginForEvent(event)).toBe(
        "https://940ebc5a83164aa6a37dde445e494f3a-fluid-crack-ctnhvsyb.builderio.xyz",
      );
      expect(getBuilderBrowserStatusForEvent(event).connectUrl).toBe(
        "https://940ebc5a83164aa6a37dde445e494f3a-fluid-crack-ctnhvsyb.builderio.xyz/dispatch/_agent-native/builder/connect",
      );
    });

    it("derives the relay requestOrigin from x-forwarded-host so verification passes behind the preview proxy", () => {
      process.env.NODE_ENV = "production";
      process.env[BUILDER_RELAY_SECRET_ENV] =
        "builder-relay-secret-example-at-least-32-characters";

      const previewOrigin = "https://preview-example.builderio.xyz";

      // The relay POST lands on the internal loopback host, but the preview
      // proxy forwards the public host that minted the signed state.
      const event = createBuilderBrowserEvent({
        host: "127.0.0.1:8094",
        "x-forwarded-host": "preview-example.builderio.xyz",
        "x-forwarded-proto": "https",
      });

      expect(getBuilderBrowserOriginForEvent(event)).toBe(previewOrigin);

      const now = Date.UTC(2026, 6, 14, 18, 0, 0);
      const relay = signBuilderPreviewRelayState({
        ownerEmail: "owner@example.com",
        targetOrigin: previewOrigin,
        basePath: "/clips",
        now,
      });
      const credentials: BuilderRelayCredentials = {
        privateKey: "private-key-example",
        publicKey: "public-key-example",
        userId: "user-example",
        orgName: "Example Organization",
        orgKind: "space",
        subscription: null,
        subscriptionLevel: null,
        subscriptionName: null,
        isEnterprise: null,
        isFreeAccount: null,
      };
      const request = createBuilderRelayRequest(relay.state, credentials, {
        now,
      });
      const relayHeaders = {
        timestamp: request.headers[BUILDER_RELAY_TIMESTAMP_HEADER],
        flowId: request.headers[BUILDER_RELAY_FLOW_HEADER],
        signature: request.headers[BUILDER_RELAY_SIGNATURE_HEADER],
      };

      // The fix: requestOrigin is the forwarded host and matches targetOrigin.
      expect(
        verifyBuilderRelayRequest({
          body: request.body,
          ...relayHeaders,
          requestOrigin: getBuilderBrowserOriginForEvent(event),
          requestBasePath: "/clips",
          now,
        }),
      ).not.toBeNull();

      // The old behavior used the internal loopback origin and failed.
      expect(
        verifyBuilderRelayRequest({
          body: request.body,
          ...relayHeaders,
          requestOrigin: "http://127.0.0.1:8094",
          requestBasePath: "/clips",
          now,
        }),
      ).toBeNull();
    });

    it("uses the immutable Netlify deploy URL as the relay destination", () => {
      process.env.AGENT_NATIVE_BUILD_ID = "6a62ed72f518f00008436fa3";
      process.env.SITE_NAME = "agent-native-content";

      expect(
        resolveBuilderPreviewRelayTargetOrigin(
          "https://deploy-preview-2382--agent-native-content.netlify.app",
        ),
      ).toBe(
        "https://6a62ed72f518f00008436fa3--agent-native-content.netlify.app",
      );
    });

    it("rejects an immutable Netlify deploy URL for a different site", () => {
      process.env.AGENT_NATIVE_BUILD_ID = "6a62ed72f518f00008436fa3";
      process.env.SITE_NAME = "different-site";
      const previewOrigin =
        "https://deploy-preview-2382--agent-native-content.netlify.app";

      expect(resolveBuilderPreviewRelayTargetOrigin(previewOrigin)).toBe(
        previewOrigin,
      );
    });

    it("leaves non-Netlify preview origins unchanged", () => {
      process.env.AGENT_NATIVE_BUILD_ID = "6a62ed72f518f00008436fa3";
      process.env.SITE_NAME = "agent-native-content";
      const previewOrigin = "https://preview-example.builderio.xyz";

      expect(resolveBuilderPreviewRelayTargetOrigin(previewOrigin)).toBe(
        previewOrigin,
      );
    });

    it("keeps the visible preview opener separate from the immutable relay target", () => {
      expect(
        resolveBuilderPreviewRelayParentOrigin({
          openerOrigin:
            "https://deploy-preview-2382--agent-native-content.netlify.app",
          targetOrigin:
            "https://6a62ed72f518f00008436fa3--agent-native-content.netlify.app",
        }),
      ).toBe("https://deploy-preview-2382--agent-native-content.netlify.app");
    });

    it("falls back to the signed relay target for an unsafe opener", () => {
      const targetOrigin =
        "https://6a62ed72f518f00008436fa3--agent-native-content.netlify.app";
      expect(
        resolveBuilderPreviewRelayParentOrigin({
          openerOrigin: "https://attacker.example",
          targetOrigin,
        }),
      ).toBe(targetOrigin);
    });

    it("rejects an unsigned Netlify opener for a different site", () => {
      const targetOrigin =
        "https://6a62ed72f518f00008436fa3--agent-native-content.netlify.app";
      expect(
        resolveBuilderPreviewRelayParentOrigin({
          openerOrigin:
            "https://deploy-preview-2382--attacker-site.netlify.app",
          targetOrigin,
        }),
      ).toBe(targetOrigin);
    });

    it("returns users to the preview opener after a gateway callback", () => {
      process.env.NODE_ENV = "production";
      process.env.AGENT_NATIVE_WORKSPACE = "1";
      process.env.APP_URL = "https://agent-workspace.builder.io";
      process.env.WORKSPACE_GATEWAY_URL = "https://agent-workspace.builder.io";
      process.env.APP_BASE_PATH = "/dispatch";

      const event = createBuilderBrowserEvent({
        "x-forwarded-host": "agent-workspace.builder.io",
        "x-forwarded-proto": "https",
      });

      expect(
        resolveBuilderCallbackReturnUrl({
          event,
          openerOrigin:
            "https://940ebc5a83164aa6a37dde445e494f3a-fluid-crack-ctnhvsyb.builderio.xyz",
          previewUrl: "https://agent-workspace.builder.io/dispatch",
        }),
      ).toBe(
        "https://940ebc5a83164aa6a37dde445e494f3a-fluid-crack-ctnhvsyb.builderio.xyz/dispatch",
      );
    });

    it("falls back to the configured public origin for untrusted hosts", () => {
      process.env.NODE_ENV = "production";
      process.env.AGENT_NATIVE_WORKSPACE = "1";
      process.env.WORKSPACE_GATEWAY_URL = "https://agent-workspace.builder.io";

      const event = createBuilderBrowserEvent({
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
      });

      expect(getBuilderBrowserStatusForEvent(event).connectUrl).toBe(
        "https://agent-workspace.builder.io/_agent-native/builder/connect",
      );
    });

    it("uses the app's localhost origin for cli-auth when reached via a tunnel Builder rejects (local dev)", () => {
      // Reproduces the ngrok/tunnel dev case: the app runs on this machine, the
      // browser is on this machine, and the tunnel host is not in Builder's
      // /cli-auth allow-list. Without the fallback the app hands Builder the
      // rejected origin and Builder redirects to its own dead
      // http://localhost:10110/auth.
      delete process.env.NODE_ENV;
      process.env.PORT = "8080";

      const event = createBuilderBrowserEvent({
        "x-forwarded-host": "alice.ngrok.io",
        "x-forwarded-proto": "https",
      });

      const target = resolveBuilderCliAuthCallbackTargetForEvent(event);
      expect(target).toEqual({
        origin: "http://localhost:8080",
        reachable: true,
      });
    });

    it("never sends a Builder-hosted preview back to a loopback callback", () => {
      // The reported blank-popup bug: a Fusion preview runs in a container, so
      // http://localhost:8080 resolves on the *visitor's* machine. Builder
      // redirected the popup there after the space picker and it went blank
      // (and handed the p-key to whatever was listening).
      delete process.env.NODE_ENV;
      process.env.PORT = "8080";
      process.env.BETTER_AUTH_URL = "http://127.0.0.1:8080";

      const event = createBuilderBrowserEvent({
        "x-forwarded-host": "alice.builderio.xyz",
        "x-forwarded-proto": "https",
      });

      const target = resolveBuilderCliAuthCallbackTargetForEvent(event);
      expect(target.reachable).toBe(false);
      expect(target.origin).toBe("https://alice.builderio.xyz");

      const redirectUrl = new URL(
        new URL(
          buildBuilderCliAuthUrl(
            target.origin,
            signBuilderCallbackState("alice@example.com"),
          ),
        ).searchParams.get("redirect_url")!,
      );
      expect(redirectUrl.hostname).not.toBe("localhost");
      expect(redirectUrl.hostname).not.toBe("127.0.0.1");
    });

    it("refuses the loopback callback a Fusion container advertises", () => {
      // The live Fusion dev-container shape: the visitor is on FUSION_ENV_ORIGIN
      // while every configured origin points at the container's own loopback
      // port, so there is nowhere Builder can redirect back to.
      delete process.env.NODE_ENV;
      process.env.PORT = "8080";
      process.env.BETTER_AUTH_URL = "http://127.0.0.1:8080";
      process.env.WORKSPACE_GATEWAY_URL = "http://127.0.0.1:8080";
      process.env.FUSION_ENV_ORIGIN = "https://alice-key-nail.builderio.xyz";

      const event = createBuilderBrowserEvent({
        "x-forwarded-host": "127.0.0.1:8080",
        "x-forwarded-proto": "http",
      });

      expect(resolveBuilderCliAuthCallbackTargetForEvent(event)).toEqual({
        origin: "https://alice-key-nail.builderio.xyz",
        reachable: false,
      });
    });

    it("uses a configured public gateway for a Builder-hosted preview", () => {
      delete process.env.NODE_ENV;
      process.env.PORT = "8080";
      process.env.BETTER_AUTH_URL = "http://127.0.0.1:8080";
      process.env.WORKSPACE_GATEWAY_URL = "https://agent-workspace.builder.io";

      const event = createBuilderBrowserEvent({
        "x-forwarded-host": "alice.builderio.xyz",
        "x-forwarded-proto": "https",
      });

      expect(resolveBuilderCliAuthCallbackTargetForEvent(event)).toEqual({
        origin: "https://agent-workspace.builder.io",
        reachable: true,
      });
    });

    it("does not use the localhost cli-auth fallback in production", () => {
      process.env.NODE_ENV = "production";
      process.env.PORT = "8080";

      const event = createBuilderBrowserEvent({
        "x-forwarded-host": "alice.builderio.xyz",
        "x-forwarded-proto": "https",
      });

      // Unchanged production behavior: with no gateway configured it returns the
      // preview origin (never a localhost callback), and reports that Builder
      // has nowhere reachable to redirect back to.
      expect(resolveBuilderCliAuthCallbackTargetForEvent(event)).toEqual({
        origin: "https://alice.builderio.xyz",
        reachable: false,
      });
    });
  });

  describe("Builder branch project configuration", () => {
    beforeEach(() => {
      resolverMocks.getSetting.mockReset();
      resolverMocks.getRequestOrgId.mockReset();
      resolverMocks.getRequestUserEmail.mockReset();
      resolverMocks.resolveSecret.mockReset();
      resolverMocks.getSetting.mockResolvedValue(null);
      resolverMocks.getRequestOrgId.mockReturnValue(undefined);
      resolverMocks.getRequestUserEmail.mockReturnValue(undefined);
      resolverMocks.resolveSecret.mockResolvedValue(null);
    });

    it("does not default to a workspace-specific project id", () => {
      delete process.env.DISPATCH_BUILDER_PROJECT_ID;
      delete process.env.BUILDER_BRANCH_PROJECT_ID;
      delete process.env.BUILDER_PROJECT_ID;
      process.env.ENABLE_BUILDER = "true";

      expect(getBuilderBranchProjectId()).toBe("");
      expect(isBuilderBranchingEnabled()).toBe(false);
    });

    it("enables branch creation when a project id is explicitly configured", () => {
      delete process.env.DISPATCH_BUILDER_PROJECT_ID;
      delete process.env.BUILDER_PROJECT_ID;
      process.env.BUILDER_BRANCH_PROJECT_ID = " project-123 ";

      expect(getBuilderBranchProjectId()).toBe("project-123");
      expect(isBuilderBranchingEnabled()).toBe(true);
    });

    it("uses the org-scoped Dispatch setting before env or secret fallbacks", async () => {
      resolverMocks.getRequestOrgId.mockReturnValue("org-123");
      resolverMocks.getSetting.mockResolvedValue({
        builderProjectId: " dispatch-project ",
      });
      process.env.BUILDER_BRANCH_PROJECT_ID = "env-project";

      await expect(resolveBuilderBranchProjectId()).resolves.toBe(
        "dispatch-project",
      );
      expect(resolverMocks.getSetting).toHaveBeenCalledWith(
        "dispatch-app-creation-settings:org:org-123",
      );
      expect(resolverMocks.resolveSecret).not.toHaveBeenCalled();
    });

    it("uses the authenticated user-scoped Dispatch setting without an org", async () => {
      resolverMocks.getRequestUserEmail.mockReturnValue("user@example.test");
      resolverMocks.getSetting.mockResolvedValue({
        builderProjectId: "user-project",
      });

      await expect(resolveBuilderBranchProjectId()).resolves.toBe(
        "user-project",
      );
      expect(resolverMocks.getSetting).toHaveBeenCalledWith(
        "dispatch-app-creation-settings:user:user@example.test",
      );
    });

    it("treats an explicit null or empty Dispatch project as disabled", async () => {
      resolverMocks.getRequestOrgId.mockReturnValue("org-123");
      process.env.BUILDER_BRANCH_PROJECT_ID = "stale-env-project";
      resolverMocks.resolveSecret.mockResolvedValue("stale-secret-project");

      resolverMocks.getSetting.mockResolvedValue({ builderProjectId: null });
      await expect(resolveBuilderBranchProjectId()).resolves.toBe("");

      resolverMocks.getSetting.mockResolvedValue({ builderProjectId: "  " });
      await expect(resolveBuilderBranchProjectId()).resolves.toBe("");
      expect(resolverMocks.resolveSecret).not.toHaveBeenCalled();
    });

    it("fails closed when the scoped Dispatch setting cannot be read", async () => {
      resolverMocks.getRequestOrgId.mockReturnValue("org-123");
      resolverMocks.getSetting.mockRejectedValue(new Error("settings down"));
      process.env.BUILDER_BRANCH_PROJECT_ID = "stale-env-project";
      resolverMocks.resolveSecret.mockResolvedValue("stale-secret-project");

      await expect(resolveBuilderBranchProjectId()).resolves.toBe("");
      expect(resolverMocks.resolveSecret).not.toHaveBeenCalled();
    });

    it("keeps legacy fallbacks when no scoped Dispatch row exists", async () => {
      resolverMocks.getRequestOrgId.mockReturnValue("org-123");
      resolverMocks.resolveSecret.mockImplementation(async (key: string) =>
        key === "BUILDER_BRANCH_PROJECT_ID" ? " secret-project " : null,
      );

      await expect(resolveBuilderBranchProjectId()).resolves.toBe(
        "secret-project",
      );
      expect(resolverMocks.getSetting).toHaveBeenCalledWith(
        "dispatch-app-creation-settings:org:org-123",
      );
      expect(resolverMocks.resolveSecret).toHaveBeenCalledWith(
        "DISPATCH_BUILDER_PROJECT_ID",
      );
      expect(resolverMocks.resolveSecret).toHaveBeenCalledWith(
        "BUILDER_BRANCH_PROJECT_ID",
      );
    });

    it("keeps the env fallback when the request has no org or user context", async () => {
      process.env.BUILDER_BRANCH_PROJECT_ID = "env-project";

      await expect(resolveBuilderBranchProjectId()).resolves.toBe(
        "env-project",
      );
      expect(resolverMocks.getSetting).not.toHaveBeenCalled();
    });
  });

  describe("runBuilderAgent", () => {
    it("requires an explicit Builder project id", async () => {
      process.env.BUILDER_PRIVATE_KEY = "bpk-test";
      process.env.BUILDER_PUBLIC_KEY = "pub-test";
      process.env.BUILDER_USER_ID = "builder-user-123";

      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      await expect(
        runBuilderAgent({
          prompt: "Create an app",
          userEmail: "dispatch+slack@integration.local",
        }),
      ).rejects.toThrow("Builder project ID is not configured");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("attributes the branch to the requesting user, not the connected credential", async () => {
      process.env.BUILDER_PRIVATE_KEY = "bpk-test";
      process.env.BUILDER_PUBLIC_KEY = "pub-test";
      process.env.BUILDER_USER_ID = "builder-user-123";
      process.env.BUILDER_API_HOST = "https://api.test.builder.io";

      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            branchName: "qa-branch",
            projectId: "project-123",
            url: "https://builder.io/app/projects/project-123/branch/qa-branch",
            status: "processing",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      vi.stubGlobal("fetch", fetchSpy);

      await runBuilderAgent({
        prompt: "Create an app",
        projectId: "project-123",
        userEmail: "brent@builder.io",
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.userEmail).toBe("brent@builder.io");
      expect(body.userId).toBeUndefined();
    });

    it("bounds a stalled agent run instead of leaving the MCP request hanging", async () => {
      process.env.BUILDER_PRIVATE_KEY = "bpk-test";
      process.env.BUILDER_PUBLIC_KEY = "pub-test";
      process.env.BUILDER_API_HOST = "https://api.test.builder.io";

      const fetchSpy = vi
        .fn()
        .mockRejectedValue(
          new DOMException("request timed out", "TimeoutError"),
        );
      vi.stubGlobal("fetch", fetchSpy);

      await expect(
        runBuilderAgent({
          prompt: "Create an app",
          projectId: "project-123",
          userEmail: "brent@builder.io",
        }),
      ).rejects.toThrow("Builder agent run timed out after 30000ms");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("falls back to the credential user when the caller email is not a Space member", async () => {
      process.env.BUILDER_PRIVATE_KEY = "bpk-test";
      process.env.BUILDER_PUBLIC_KEY = "pub-test";
      process.env.BUILDER_USER_ID = "builder-user-123";
      process.env.BUILDER_API_HOST = "https://api.test.builder.io";

      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "User not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              branchName: "qa-branch",
              projectId: "project-123",
              url: "https://builder.io/app/projects/project-123/branch/qa-branch",
              status: "processing",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      vi.stubGlobal("fetch", fetchSpy);

      const result = await runBuilderAgent({
        prompt: "Create an app",
        projectId: "project-123",
        userEmail: "dispatch+slack@integration.local",
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const first = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(first.userEmail).toBe("dispatch+slack@integration.local");
      const second = JSON.parse(fetchSpy.mock.calls[1][1].body);
      expect(second.userId).toBe("builder-user-123");
      expect(second.userEmail).toBeUndefined();
      expect(result.branchName).toBe("qa-branch");
    });

    it("rejects a blank branchName from Builder instead of returning an unusable run", async () => {
      process.env.BUILDER_PRIVATE_KEY = "bpk-test";
      process.env.BUILDER_PUBLIC_KEY = "pub-test";
      process.env.BUILDER_USER_ID = "builder-user-123";

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              branchName: " ",
              projectId: "project-123",
              url: "https://builder.io/app/projects/project-123/branch/qa",
              status: "processing",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );

      await expect(
        runBuilderAgent({
          prompt: "Create an app",
          projectId: "project-123",
          userEmail: "dispatch+slack@integration.local",
        }),
      ).rejects.toThrow("Builder agent run returned a blank branchName");
    });

    it("rejects a malformed Builder branch URL instead of returning it", async () => {
      process.env.BUILDER_PRIVATE_KEY = "bpk-test";
      process.env.BUILDER_PUBLIC_KEY = "pub-test";
      process.env.BUILDER_USER_ID = "builder-user-123";

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              branchName: "qa-branch",
              projectId: "project-123",
              url: "not a url",
              status: "processing",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );

      await expect(
        runBuilderAgent({
          prompt: "Create an app",
          projectId: "project-123",
          userEmail: "dispatch+slack@integration.local",
        }),
      ).rejects.toThrow("Builder agent run returned a malformed url");
    });

    it("rejects a non-Builder branch URL instead of returning it", async () => {
      process.env.BUILDER_PRIVATE_KEY = "bpk-test";
      process.env.BUILDER_PUBLIC_KEY = "pub-test";
      process.env.BUILDER_USER_ID = "builder-user-123";

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              branchName: "qa-branch",
              projectId: "project-123",
              url: "https://example.com/branch",
              status: "processing",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );

      await expect(
        runBuilderAgent({
          prompt: "Create an app",
          projectId: "project-123",
          userEmail: "dispatch+slack@integration.local",
        }),
      ).rejects.toThrow("Builder agent run returned a non-Builder url");
    });
  });

  describe("Builder project API", () => {
    beforeEach(() => {
      process.env.BUILDER_PRIVATE_KEY = "bpk-test";
      process.env.BUILDER_PUBLIC_KEY = "pub-test";
      process.env.BUILDER_API_HOST = "https://api.test.builder.io";
      process.env.BUILDER_APP_HOST = "https://builder.io";
    });

    it("creates a project from a connected repository", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "success",
            project: {
              id: "project-123",
              name: "Agent-Native Workspace",
              repoUrl:
                "https://github.com/BuilderIO/builder-agent-native-workspace",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      vi.stubGlobal("fetch", fetchSpy);

      const result = await createBuilderProject({
        name: "Agent-Native Workspace",
        repoUrl: "https://github.com/BuilderIO/builder-agent-native-workspace",
      });

      expect(result).toEqual({
        projectId: "project-123",
        name: "Agent-Native Workspace",
        repoUrl: "https://github.com/BuilderIO/builder-agent-native-workspace",
        browserUrl: "https://builder.io/app/projects/project-123",
        created: true,
      });
      expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
        "https://api.test.builder.io/projects/create?apiKey=pub-test",
      );
      expect(JSON.parse(fetchSpy.mock.calls[0]?.[1].body)).toEqual({
        source: {
          kind: "repo",
          repoUrl:
            "https://github.com/BuilderIO/builder-agent-native-workspace",
        },
        name: "Agent-Native Workspace",
      });
    });

    it("reuses a project already connected to the workspace repository", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "success",
            projects: [
              {
                id: "project-other",
                name: "Other",
                repoUrl: "https://github.com/BuilderIO/other",
              },
              {
                id: "project-123",
                name: "Agent-Native Workspace",
                repoUrl:
                  "https://github.com/BuilderIO/builder-agent-native-workspace.git",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      vi.stubGlobal("fetch", fetchSpy);

      await expect(
        findBuilderProjectForRepo({
          repoUrl:
            "https://github.com/BuilderIO/builder-agent-native-workspace",
        }),
      ).resolves.toMatchObject({
        projectId: "project-123",
        created: false,
      });
      expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
        "https://api.test.builder.io/projects?apiKey=pub-test&includeHidden=true",
      );
    });

    it("bounds a stalled project lookup instead of leaving provisioning hanging", async () => {
      const fetchSpy = vi
        .fn()
        .mockRejectedValue(new DOMException("request timed out", "AbortError"));
      vi.stubGlobal("fetch", fetchSpy);

      await expect(
        findBuilderProjectForRepo({
          repoUrl:
            "https://github.com/BuilderIO/builder-agent-native-workspace",
        }),
      ).rejects.toThrow("Builder project lookup timed out after 30000ms");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });
});
