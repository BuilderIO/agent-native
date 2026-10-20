import { createApp } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const activeContext = vi.hoisted(() => ({
  userEmail: undefined as string | undefined,
  orgId: undefined as string | undefined,
}));
const discoverOrgDirectoryAgentsMock = vi.hoisted(() => vi.fn());
const listOrganizationVisibleWorkspaceAppsMock = vi.hoisted(() => vi.fn());
const listWorkspaceAppsMock = vi.hoisted(() => vi.fn());
const orgAppsDirectoryCacheMock = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const inFlight = new Map<string, Promise<unknown>>();
  return {
    async get(key: string, load: () => Promise<unknown>) {
      if (values.has(key)) return values.get(key);
      const pending = inFlight.get(key);
      if (pending) return pending;
      const refresh = load()
        .then((value) => {
          values.set(key, value);
          return value;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, refresh);
      return refresh;
    },
    clear() {
      values.clear();
      inFlight.clear();
    },
  };
});
const runWithRequestContextMock = vi.hoisted(() =>
  vi.fn(
    async (
      context: { orgId?: string; userEmail?: string },
      run: () => Promise<unknown>,
    ) => {
      const previous = activeContext.userEmail;
      const previousOrgId = activeContext.orgId;
      activeContext.userEmail = context.userEmail;
      activeContext.orgId = context.orgId;
      try {
        return await run();
      } finally {
        activeContext.userEmail = previous;
        activeContext.orgId = previousOrgId;
      }
    },
  ),
);
const verifyA2ATokenMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/a2a", () => ({
  verifyA2AToken: verifyA2ATokenMock,
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgDomain: vi.fn(async () => "example.test"),
  resolveOrgByDomain: vi.fn(async () => ({
    orgId: "org-123",
    orgName: "Example",
  })),
}));

vi.mock("@agent-native/core/server", () => ({
  getH3App: vi.fn(),
  runWithRequestContext: runWithRequestContextMock,
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  discoverOrgDirectoryAgents: discoverOrgDirectoryAgentsMock,
}));

vi.mock("@agent-native/dispatch/server", () => ({
  listOrganizationVisibleWorkspaceApps:
    listOrganizationVisibleWorkspaceAppsMock,
  listWorkspaceApps: listWorkspaceAppsMock,
  orgAppsDirectoryCache: orgAppsDirectoryCacheMock,
}));

import {
  _resetOrgAppsDirectoryCache,
  orgAppsHandler,
} from "./org-apps-directory.js";

function tokenForUser(email: string): string {
  return `user:${encodeURIComponent(email)}`;
}

async function request(
  url = "https://dispatch.example.test/_agent-native/org/apps",
  extraHeaders: Record<string, string> = {},
  token = tokenForUser("Operator@Example.Test"),
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
        authorization: `Bearer ${token}`,
        "x-agent-native-include-directory-app": "1",
        ...extraHeaders,
      },
    },
    { clientAddress: "127.0.0.1" },
  );
}

function availableAgents(agents: unknown[] = []) {
  return { status: "available", agents };
}

describe("org apps directory handler", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_PATH", "");
    vi.stubEnv("VITE_APP_BASE_PATH", "");
    _resetOrgAppsDirectoryCache();
    activeContext.userEmail = undefined;
    activeContext.orgId = undefined;
    discoverOrgDirectoryAgentsMock
      .mockReset()
      .mockResolvedValue(availableAgents());
    listWorkspaceAppsMock.mockReset().mockResolvedValue([]);
    listOrganizationVisibleWorkspaceAppsMock.mockReset().mockResolvedValue([]);
    runWithRequestContextMock.mockClear();
    verifyA2ATokenMock.mockReset().mockImplementation(async (token: string) => {
      if (token === "org-only") {
        return {
          email: null,
          orgDomain: "example.test",
          orgId: "org-123",
          identityAssurance: "organization",
        };
      }
      if (token.startsWith("user:")) {
        return {
          email: decodeURIComponent(token.slice("user:".length)),
          orgDomain: "example.test",
          orgId: "org-123",
        };
      }
      return { email: null, orgDomain: null };
    });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses Core's verified user identity as the request and cache scope", async () => {
    discoverOrgDirectoryAgentsMock.mockResolvedValue(
      availableAgents([
        {
          id: "content",
          name: "Content",
          description: "Content app",
          url: "https://content.agent-native.com",
          color: "#000000",
          source: "builtin",
        },
      ]),
    );

    const [first, second] = await Promise.all([request(), request()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(discoverOrgDirectoryAgentsMock).toHaveBeenCalledTimes(1);
    expect(runWithRequestContextMock).toHaveBeenCalledWith(
      { orgId: "org-123", userEmail: "operator@example.test" },
      expect.any(Function),
    );
    expect(listWorkspaceAppsMock).toHaveBeenCalledWith({
      includeAgentCards: false,
      audience: "all",
    });
    expect(await first.json()).toMatchObject({
      apps: [expect.objectContaining({ id: "content" })],
    });

    expect((await request()).status).toBe(200);
    expect(discoverOrgDirectoryAgentsMock).toHaveBeenCalledTimes(1);
  });

  it("lets organization principals see org-visible apps without exposing private apps", async () => {
    listOrganizationVisibleWorkspaceAppsMock.mockResolvedValue([
      {
        id: "qr",
        status: "ready",
        visibility: "org",
        orgEnabled: true,
        url: "https://qr.example.test",
      },
      {
        id: "private-qr",
        status: "ready",
        visibility: "private",
        orgEnabled: true,
        url: "https://private-qr.example.test",
      },
    ]);
    discoverOrgDirectoryAgentsMock.mockResolvedValue(
      availableAgents([
        {
          id: "qr",
          name: "QR",
          description: "Generate QR codes",
          url: "https://qr.example.test",
          color: "#000000",
          source: "workspace",
        },
        {
          id: "private-qr",
          name: "Private QR",
          description: "Private QR app",
          url: "https://private-qr.example.test",
          color: "#000000",
          source: "workspace",
        },
      ]),
    );

    const response = await request(
      "https://dispatch.example.test/_agent-native/org/apps",
      {},
      "org-only",
    );

    expect(response.status).toBe(200);
    expect(
      (await response.json()).apps.map((app: { id: string }) => app.id),
    ).toEqual(["qr"]);
    expect(listOrganizationVisibleWorkspaceAppsMock).toHaveBeenCalledOnce();
    expect(listWorkspaceAppsMock).not.toHaveBeenCalled();
    expect(runWithRequestContextMock).toHaveBeenCalledWith(
      { orgId: "org-123" },
      expect.any(Function),
    );
    expect(discoverOrgDirectoryAgentsMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ allowedWorkspaceAppIds: new Set(["qr"]) }),
    );
  });

  it("lets a verified user see only their own private workspace apps", async () => {
    const discovered = ["own-private", "other-private"].map((id) => ({
      id,
      name: id,
      description: id,
      url: `https://${id}.example.test`,
      color: "#000000",
      source: "workspace" as const,
    }));
    listWorkspaceAppsMock.mockResolvedValue([
      {
        id: "own-private",
        owner: "operator@example.test",
        status: "ready",
        visibility: "private",
        orgEnabled: true,
        url: "https://own-private.example.test",
      },
      {
        id: "other-private",
        owner: "other@example.test",
        status: "ready",
        visibility: "private",
        orgEnabled: true,
        url: "https://other-private.example.test",
      },
    ]);
    discoverOrgDirectoryAgentsMock.mockResolvedValue(
      availableAgents(discovered),
    );

    const response = await request(
      "https://dispatch.example.test/_agent-native/org/apps",
      {},
      tokenForUser("Operator@Example.Test"),
    );

    expect(response.status).toBe(200);
    expect(
      (await response.json()).apps.map((app: { id: string }) => app.id),
    ).toEqual(["own-private"]);
  });

  it("keeps organization and user directory caches separate", async () => {
    const discovered = ["qr", "private-qr"].map((id) => ({
      id,
      name: id,
      description: id,
      url: `https://${id}.example.test`,
      color: "#000000",
      source: "workspace" as const,
    }));
    discoverOrgDirectoryAgentsMock.mockResolvedValue(
      availableAgents(discovered),
    );
    listOrganizationVisibleWorkspaceAppsMock.mockResolvedValue([
      {
        id: "qr",
        status: "ready",
        visibility: "org",
        orgEnabled: true,
        url: "https://qr.example.test",
      },
    ]);
    listWorkspaceAppsMock.mockResolvedValue([
      {
        id: "qr",
        status: "ready",
        visibility: "org",
        orgEnabled: true,
        url: "https://qr.example.test",
      },
      {
        id: "private-qr",
        owner: "operator@example.test",
        status: "ready",
        visibility: "private",
        orgEnabled: true,
        url: "https://private-qr.example.test",
      },
    ]);

    const organization = await request(
      "https://dispatch.example.test/_agent-native/org/apps",
      {},
      "org-only",
    );
    const user = await request(
      "https://dispatch.example.test/_agent-native/org/apps",
      {},
      tokenForUser("operator@example.test"),
    );

    expect(
      (await organization.json()).apps.map((app: { id: string }) => app.id),
    ).toEqual(["qr"]);
    expect(
      (await user.json()).apps.map((app: { id: string }) => app.id),
    ).toEqual(["private-qr", "qr"]);
    expect(discoverOrgDirectoryAgentsMock).toHaveBeenCalledTimes(2);
  });

  it("keeps successful cache entries isolated by normalized caller email", async () => {
    const discovered = [
      {
        id: "alice-app",
        name: "Alice app",
        description: "Alice app",
        url: "https://alice.example.test",
        color: "#000000",
        source: "workspace",
      },
      {
        id: "bob-app",
        name: "Bob app",
        description: "Bob app",
        url: "https://bob.example.test",
        color: "#000000",
        source: "workspace",
      },
    ];
    discoverOrgDirectoryAgentsMock.mockResolvedValue(
      availableAgents(discovered),
    );
    listWorkspaceAppsMock.mockImplementation(async () =>
      activeContext.userEmail === "alice@example.test"
        ? [
            {
              id: "alice-app",
              status: "ready",
              visibility: "org",
              orgEnabled: true,
              url: "https://alice.example.test",
            },
          ]
        : [
            {
              id: "bob-app",
              status: "ready",
              visibility: "org",
              orgEnabled: true,
              url: "https://bob.example.test",
            },
          ],
    );

    const alice = await request(
      "https://dispatch.example.test/_agent-native/org/apps",
      {},
      tokenForUser("Alice@Example.Test"),
    );
    const bob = await request(
      "https://dispatch.example.test/_agent-native/org/apps",
      {},
      tokenForUser("Bob@Example.Test"),
    );

    expect(
      (await alice.json()).apps.map((app: { id: string }) => app.id),
    ).toEqual(["alice-app"]);
    expect(
      (await bob.json()).apps.map((app: { id: string }) => app.id),
    ).toEqual(["bob-app"]);
    expect(discoverOrgDirectoryAgentsMock).toHaveBeenCalledTimes(2);
  });

  it("excludes private, disabled, pending, unready, and inaccessible workspace apps", async () => {
    discoverOrgDirectoryAgentsMock.mockResolvedValue(
      availableAgents(
        [
          "allowed",
          "private",
          "disabled",
          "pending",
          "unready",
          "inaccessible",
        ].map((id) => ({
          id,
          name: id,
          description: `${id} description`,
          url: `https://${id}.example.test`,
          color: "#000000",
          source: "workspace",
        })),
      ),
    );
    listWorkspaceAppsMock.mockResolvedValue([
      {
        id: "allowed",
        status: "ready",
        visibility: "org",
        orgEnabled: true,
        url: "https://allowed.example.test",
      },
      {
        id: "private",
        status: "ready",
        visibility: "private",
        orgEnabled: true,
        url: "https://private.example.test",
      },
      {
        id: "disabled",
        status: "ready",
        visibility: "org",
        orgEnabled: false,
        url: "https://disabled.example.test",
      },
      {
        id: "pending",
        status: "pending",
        visibility: "org",
        orgEnabled: true,
        url: "https://pending.example.test",
      },
      {
        id: "unready",
        status: "building",
        visibility: "org",
        orgEnabled: true,
        url: "https://unready.example.test",
      },
    ]);

    const response = await request();
    expect(response.status).toBe(200);
    expect(
      (await response.json()).apps.map((app: { id: string }) => app.id),
    ).toEqual(["allowed"]);
  });

  it("preserves descriptions and legacy capabilities on the wire", async () => {
    discoverOrgDirectoryAgentsMock.mockResolvedValue(
      availableAgents([
        {
          id: "content",
          name: "Content",
          description: "Create and organize workspace content.",
          whenToUse: ["When users need workspace content."],
          aliases: ["content library", "workspace content"],
          url: "https://content.agent-native.com",
          color: "#000000",
          source: "builtin",
        },
      ]),
    );

    const response = await request();
    expect(response.status).toBe(200);
    expect((await response.json()).apps).toEqual([
      expect.objectContaining({
        id: "content",
        description: "Create and organize workspace content.",
        whenToUse: ["When users need workspace content."],
        aliases: ["content library", "workspace content"],
        capabilities: "Create and organize workspace content.",
      }),
    ]);
  });

  it("returns 503 and does not cache strict discovery failure", async () => {
    discoverOrgDirectoryAgentsMock
      .mockResolvedValueOnce({
        status: "unavailable",
        reason: "remote-manifests",
      })
      .mockResolvedValueOnce(availableAgents());

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
