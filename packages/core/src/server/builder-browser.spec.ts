import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildBuilderCliAuthUrl,
  BUILDER_CALLBACK_PATH,
  BUILDER_STATE_PARAM,
  getBuilderBrowserConnectUrl,
  runBuilderAgent,
  signBuilderCallbackState,
  verifyBuilderCallbackState,
} from "./builder-browser.js";

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

  describe("buildBuilderCliAuthUrl", () => {
    // The connect flow switched to server-side pending state (stored in the
    // settings table) rather than embedding a signed _an_state token in the
    // redirect_url query string.  Builder's /cli-auth page was stripping the
    // existing query params from redirect_url when it appended p-key/api-key,
    // so _an_state was always null when the callback fired.  The connect route
    // now calls buildBuilderCliAuthUrl(origin, null) — no state in the URL.
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
      expect(redirectUrl).toBe(
        "https://alice.agent-native.com/_agent-native/builder/callback",
      );
    });

    it("preserves APP_BASE_PATH in redirect and preview URLs", () => {
      process.env.APP_BASE_PATH = "/docs/";
      const cliAuthUrl = buildBuilderCliAuthUrl(
        "https://alice.agent-native.com/",
      );
      const parsed = new URL(cliAuthUrl);
      expect(parsed.searchParams.get("redirect_url")).toBe(
        "https://alice.agent-native.com/docs/_agent-native/builder/callback",
      );
      expect(parsed.searchParams.get("preview_url")).toBe(
        "https://alice.agent-native.com/docs",
      );
    });

    it("preserves APP_BASE_PATH in the surfaced connect URL", () => {
      process.env.APP_BASE_PATH = "/docs/";
      expect(
        getBuilderBrowserConnectUrl("https://alice.agent-native.com/"),
      ).toBe(
        "https://alice.agent-native.com/docs/_agent-native/builder/connect",
      );
    });
  });

  describe("runBuilderAgent", () => {
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
  });
});
