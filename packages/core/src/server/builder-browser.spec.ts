import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { H3Event } from "h3";
import {
  appendBuilderConnectToken,
  buildBuilderCliAuthUrl,
  BUILDER_AGENT_NATIVE_APP_PARAM,
  BUILDER_AGENT_NATIVE_CONNECT_SOURCE_PARAM,
  BUILDER_AGENT_NATIVE_FLOW_PARAM,
  BUILDER_AGENT_NATIVE_TEMPLATE_PARAM,
  BUILDER_CALLBACK_PATH,
  BUILDER_CONNECT_PARAM,
  BUILDER_SIGNUP_SOURCE_PARAM,
  BUILDER_STATE_PARAM,
  getBuilderBranchProjectId,
  getBuilderCliAuthCallbackOriginForEvent,
  getBuilderBrowserConnectUrl,
  getBuilderBrowserConnectUrlForOwner,
  getBuilderBrowserOriginForEvent,
  getBuilderBrowserStatusForEvent,
  isBuilderBranchingEnabled,
  resolveBuilderCallbackReturnUrl,
  runBuilderAgent,
  signBuilderConnectToken,
  signBuilderCallbackState,
  verifyBuilderConnectToken,
  verifyBuilderCallbackState,
  verifyBuilderCallbackStateAndGetOwner,
  verifyBuilderConnectTokenAndGetOwner,
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

describe("Builder callback CSRF state", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Pin the secret so signed tokens are stable across calls and the
    // .env.local autogeneration in resolveAuthSecret never fires.
    process.env.BETTER_AUTH_SECRET = "test-secret-9f2a7c";
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
      // Reproduces the ngrok/tunnel dev case: the preview host is trusted by us
      // but not by Builder's /cli-auth allow-list, and no public gateway env is
      // set. Without the fallback the app hands Builder the rejected origin and
      // Builder redirects to its own dead http://localhost:10110/auth.
      delete process.env.NODE_ENV;
      process.env.PORT = "8080";
      for (const key of [
        "APP_URL",
        "VITE_APP_URL",
        "BETTER_AUTH_URL",
        "VITE_BETTER_AUTH_URL",
        "WORKSPACE_GATEWAY_URL",
        "VITE_WORKSPACE_GATEWAY_URL",
      ]) {
        delete process.env[key];
      }

      const event = createBuilderBrowserEvent({
        "x-forwarded-host": "alice.builderio.xyz",
        "x-forwarded-proto": "https",
      });

      expect(getBuilderCliAuthCallbackOriginForEvent(event)).toBe(
        "http://localhost:8080",
      );
    });

    it("does not use the localhost cli-auth fallback in production", () => {
      process.env.NODE_ENV = "production";
      process.env.PORT = "8080";
      for (const key of [
        "APP_URL",
        "VITE_APP_URL",
        "BETTER_AUTH_URL",
        "VITE_BETTER_AUTH_URL",
        "WORKSPACE_GATEWAY_URL",
        "VITE_WORKSPACE_GATEWAY_URL",
      ]) {
        delete process.env[key];
      }

      const event = createBuilderBrowserEvent({
        "x-forwarded-host": "alice.builderio.xyz",
        "x-forwarded-proto": "https",
      });

      // Unchanged production behavior: with no gateway configured it returns the
      // preview origin (never a localhost callback).
      expect(getBuilderCliAuthCallbackOriginForEvent(event)).toBe(
        "https://alice.builderio.xyz",
      );
    });
  });

  describe("Builder branch project configuration", () => {
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

    it("uses the configured Builder user id instead of caller email", async () => {
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
        userEmail: "dispatch+slack@integration.local",
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.userId).toBe("builder-user-123");
      expect(body.userEmail).toBeUndefined();
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
});
