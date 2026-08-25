import { signA2AToken } from "@agent-native/core/a2a";
import { createApp } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const discoverOrgDirectoryAgentsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/org", () => ({
  getA2ASecretByDomain: vi.fn(async () => null),
  getOrgDomain: vi.fn(async () => "example.test"),
  resolveOrgByDomain: vi.fn(async () => ({
    orgId: "org-123",
    orgName: "Example",
  })),
}));

vi.mock("@agent-native/core/server", () => ({
  getH3App: vi.fn(),
  runWithRequestContext: vi.fn(
    async (_context: unknown, run: () => Promise<unknown>) => run(),
  ),
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  discoverOrgDirectoryAgents: discoverOrgDirectoryAgentsMock,
}));

import {
  _resetOrgAppsDirectoryCache,
  orgAppsHandler,
} from "./org-apps-directory.js";

const TEST_SECRET = "fake-directory-plugin-secret";

async function authorization(): Promise<string> {
  const previous = process.env.A2A_SECRET;
  process.env.A2A_SECRET = TEST_SECRET;
  try {
    return `Bearer ${await signA2AToken(
      "operator@example.test",
      "example.test",
      undefined,
      { preferGlobalSecret: true },
    )}`;
  } finally {
    if (previous === undefined) delete process.env.A2A_SECRET;
    else process.env.A2A_SECRET = previous;
  }
}

async function request(): Promise<Response> {
  process.env.A2A_SECRET = TEST_SECRET;
  const app = createApp();
  app.use(orgAppsHandler);
  return app.request("https://dispatch.example.test/_agent-native/org/apps", {
    headers: {
      authorization: await authorization(),
      "x-agent-native-include-directory-app": "1",
    },
  });
}

describe("org apps directory handler", () => {
  beforeEach(() => {
    _resetOrgAppsDirectoryCache();
    discoverOrgDirectoryAgentsMock.mockReset();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
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
});
