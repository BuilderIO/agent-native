import type { H3Event } from "h3";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  appendBuilderConnectToken,
  BUILDER_AGENT_NATIVE_APP_PARAM,
  BUILDER_AGENT_NATIVE_CONNECT_SOURCE_PARAM,
  BUILDER_AGENT_NATIVE_FLOW_PARAM,
  BUILDER_AGENT_NATIVE_TEMPLATE_PARAM,
  BUILDER_CALLBACK_PATH,
  BUILDER_CONNECT_PARAM,
  BUILDER_SIGNUP_SOURCE_PARAM,
  getBuilderBranchProjectId,
  getBuilderBrowserConnectUrl,
  getBuilderBrowserConnectUrlForOwner,
  getBuilderBrowserOriginForEvent,
  getBuilderBrowserStatusForEvent,
  isBuilderBranchingEnabled,
  resolveBuilderCallbackReturnUrl,
  runBuilderAgent,
  signBuilderConnectToken,
  verifyBuilderConnectToken,
  verifyBuilderConnectTokenAndGetOwner,
  isBuilderConnectCallbackOriginAllowed,
  isSignedBuilderConnectState,
  createBuilderConnectState,
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

  describe("signBuilderConnectToken / verifyBuilderConnectToken", () => {
    it("verifies a fresh token bound to the same owner email", () => {
      const token = signBuilderConnectToken("alice@example.com");
      expect(verifyBuilderConnectToken(token, "alice@example.com")).toBe(true);
    });

    it("rejects a token signed for a different owner email", () => {
      const token = signBuilderConnectToken("alice@example.com");
      expect(verifyBuilderConnectToken(token, "bob@example.com")).toBe(false);
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

  describe("Builder connect OAuth state", () => {
    it("creates a signed OAuth state", () => {
      expect(isSignedBuilderConnectState(createBuilderConnectState())).toBe(
        true,
      );
    });

    it("allows only approved Builder callback origins", () => {
      expect(
        isBuilderConnectCallbackOriginAllowed("https://app.builderio.xyz"),
      ).toBe(true);
      expect(isBuilderConnectCallbackOriginAllowed("https://example.com")).toBe(
        false,
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
});
