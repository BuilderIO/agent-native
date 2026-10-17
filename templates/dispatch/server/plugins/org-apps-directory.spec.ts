import { signA2AToken } from "@agent-native/core/a2a";
import { createApp } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const discoverOrgDirectoryAgentsMock = vi.hoisted(() => vi.fn());
const runWithRequestContextMock = vi.hoisted(() =>
  vi.fn(async (_context: unknown, run: () => Promise<unknown>) => run()),
);

vi.mock("@agent-native/core/org", () => ({
  getA2ASecretByDomain: vi.fn(async () => TEST_SECRET),
  getOrgDomain: vi.fn(async () => "example.test"),
  isSoleOrgDomain: vi.fn(async () => true),
  resolveOrgByDomain: vi.fn(async () => ({
    orgId: "org-123",
    orgName: "Example",
  })),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    getH3App: vi.fn(),
    runWithRequestContext: runWithRequestContextMock,
  };
});

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  discoverOrgDirectoryAgents: discoverOrgDirectoryAgentsMock,
}));

import {
  _resetOrgAppsDirectoryCache,
  orgAppsHandler,
} from "./org-apps-directory.js";

const TEST_SECRET = "fake-directory-plugin-secret";

async function authorization(
  audience = "https://dispatch.example.test",
): Promise<string> {
  return `Bearer ${await signA2AToken(
    "operator@example.test",
    "example.test",
    TEST_SECRET,
    {
      preferGlobalSecret: false,
      audience,
    },
  )}`;
}

async function request(
  url = "https://dispatch.example.test/_agent-native/org/apps",
  extraHeaders: Record<string, string> = {},
  tokenAudience = "https://dispatch.example.test",
): Promise<Response> {
  const app = createApp();
  app.use(orgAppsHandler);
  const requestUrl = new URL(url);
  return app.request(
    url,
    {
      headers: {
        host: requestUrl.host,
        "x-forwarded-proto": requestUrl.protocol.slice(0, -1),
        authorization: await authorization(tokenAudience),
        "x-agent-native-include-directory-app": "1",
        ...extraHeaders,
      },
    },
    { clientAddress: "127.0.0.1" },
  );
}

describe("org apps directory handler", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_PATH", "");
    vi.stubEnv("VITE_APP_BASE_PATH", "");
    _resetOrgAppsDirectoryCache();
    discoverOrgDirectoryAgentsMock.mockReset();
    runWithRequestContextMock.mockClear();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("coalesces authenticated same-org discovery and caches complete success", async () => {
    discoverOrgDirectoryAgentsMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        status: "available",
        agents: [
          {
            id: "content",
            name: "Content",
            description: "Content app",
            url: "https://content.agent-native.com",
            color: "#000000",
          },
        ],
      };
    });

    const [first, second] = await Promise.all([request(), request()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(discoverOrgDirectoryAgentsMock).toHaveBeenCalledTimes(1);
    expect(runWithRequestContextMock).toHaveBeenCalledWith(
      { orgId: "org-123" },
      expect.any(Function),
    );
    expect(await first.json()).toMatchObject({
      apps: [expect.objectContaining({ id: "content" })],
    });

    expect((await request()).status).toBe(200);
    expect(discoverOrgDirectoryAgentsMock).toHaveBeenCalledTimes(1);
  });

  it("returns 503 and does not cache strict discovery failure", async () => {
    discoverOrgDirectoryAgentsMock
      .mockResolvedValueOnce({
        status: "unavailable",
        reason: "remote-manifests",
      })
      .mockResolvedValueOnce({
        status: "available",
        agents: [],
      });

    const failed = await request();
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toBe("private, no-store");
    await expect(failed.json()).resolves.toEqual({
      error: "directory_unavailable",
      reason: "remote-manifests",
    });

    expect((await request()).status).toBe(200);
    expect(discoverOrgDirectoryAgentsMock).toHaveBeenCalledTimes(2);
  });

  it("verifies an HTTPS audience when a trusted proxy terminates TLS", async () => {
    discoverOrgDirectoryAgentsMock.mockResolvedValue({
      status: "available",
      agents: [],
    });

    const response = await request(
      "http://dispatch.example.test/_agent-native/org/apps",
      { "x-forwarded-proto": "https, http" },
    );

    expect(response.status).toBe(200);
  });

  it("includes the configured mount prefix but excludes the route path", async () => {
    vi.stubEnv("APP_BASE_PATH", "/dispatch");
    discoverOrgDirectoryAgentsMock.mockResolvedValue({
      status: "available",
      agents: [],
    });

    const url = "http://dispatch.example.test/dispatch/_agent-native/org/apps";
    const headers = { "x-forwarded-proto": "https, http" };
    const response = await request(
      url,
      headers,
      "https://dispatch.example.test/dispatch",
    );

    expect(response.status).toBe(200);
    expect(
      (
        await request(
          url,
          headers,
          "https://dispatch.example.test/dispatch/_agent-native/org/apps",
        )
      ).status,
    ).toBe(401);
  });
});
