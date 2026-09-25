import type { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrgContextMock = vi.hoisted(() => vi.fn());

vi.mock("../org/context.js", () => ({
  getOrgContext: getOrgContextMock,
}));

import {
  appendBuilderConnectStateCookie,
  createBuilderConnectState,
  resolveBuilderConnectCallbackState,
} from "./builder-browser.js";
import {
  disconnectBuilderConnectionAtScope,
  parseBuilderConnectionScope,
  resolveBuilderCallbackWrite,
  resolveBuilderConnectAuthorization,
  resolveBuilderOrgMutation,
  selectLiveBuilderConnectStates,
  type BuilderScopedDisconnectDeps,
} from "./core-routes-plugin.js";

function createMockEvent(): H3Event {
  return {
    req: {
      method: "POST",
      url: "https://example.com/_agent-native/builder/connect",
      headers: new Headers({ host: "example.com" }),
    },
    url: new URL("https://example.com/_agent-native/builder/connect"),
    node: {
      req: {
        headers: { host: "example.com" },
        method: "POST",
        socket: { remoteAddress: "203.0.113.10" },
        url: "/_agent-native/builder/connect",
      },
    },
    headers: new Headers({ host: "example.com" }),
    context: {},
    path: "/_agent-native/builder/connect",
  } as unknown as H3Event;
}

beforeEach(() => {
  getOrgContextMock.mockReset();
});

describe("resolveBuilderOrgMutation", () => {
  it("allows any authenticated org member to start Builder connect", async () => {
    getOrgContextMock.mockResolvedValue({
      orgId: "org-123",
      role: "member",
    });

    await expect(
      resolveBuilderOrgMutation(createMockEvent(), {
        allowMemberInitiation: true,
      }),
    ).resolves.toEqual({
      orgId: "org-123",
      role: "member",
      deny: null,
    });
  });

  it("keeps shared Builder revocation owner/admin protected", async () => {
    getOrgContextMock.mockResolvedValue({
      orgId: "org-123",
      role: "member",
    });

    await expect(resolveBuilderOrgMutation(createMockEvent())).resolves.toEqual(
      {
        orgId: "org-123",
        role: "member",
        deny: "Only an organization owner or admin can change the shared Builder connection.",
      },
    );
  });
});

describe("Builder connection scope", () => {
  it("treats a missing scope as the legacy role-decided connect", () => {
    expect(parseBuilderConnectionScope(null)).toBeNull();
    expect(parseBuilderConnectionScope(undefined)).toBeNull();
    expect(parseBuilderConnectionScope("")).toBeNull();
    expect(parseBuilderConnectionScope("org")).toBe("org");
    expect(parseBuilderConnectionScope("personal")).toBe("personal");
  });

  it("refuses an unknown scope instead of guessing one", () => {
    expect(parseBuilderConnectionScope("user")).toBe("invalid");
    expect(parseBuilderConnectionScope(["org"])).toBe("invalid");
  });

  it("lets only owners and admins start the organization connection", async () => {
    getOrgContextMock.mockResolvedValue({ orgId: "org-123", role: "member" });
    await expect(
      resolveBuilderConnectAuthorization(
        createMockEvent(),
        "member@example.com",
        "org",
      ),
    ).resolves.toMatchObject({
      deny: "Only an organization owner or admin can change the shared Builder connection.",
    });

    getOrgContextMock.mockResolvedValue({ orgId: "org-123", role: "admin" });
    await expect(
      resolveBuilderConnectAuthorization(
        createMockEvent(),
        "admin@example.com",
        "org",
      ),
    ).resolves.toEqual({ orgId: "org-123", role: "admin", deny: null });
  });

  it("keeps a personal connection for members; owners and admins connect for the org", async () => {
    getOrgContextMock.mockResolvedValue({ orgId: "org-123", role: "member" });
    await expect(
      resolveBuilderConnectAuthorization(
        createMockEvent(),
        "member@example.com",
        "personal",
      ),
    ).resolves.toEqual({ orgId: "org-123", role: "member", deny: null });

    getOrgContextMock.mockResolvedValue({ orgId: "org-123", role: "owner" });
    await expect(
      resolveBuilderConnectAuthorization(
        createMockEvent(),
        "owner@example.com",
        "personal",
      ),
    ).resolves.toMatchObject({
      deny: "Owners and admins connect Builder.io for the organization.",
    });
  });

  it("still requires organization membership for a named connection", async () => {
    getOrgContextMock.mockResolvedValue({ orgId: null, role: null });
    await expect(
      resolveBuilderConnectAuthorization(
        createMockEvent(),
        "member@example.com",
        "personal",
      ),
    ).resolves.toMatchObject({
      deny: "Only signed-in organization members can connect Builder.",
    });
  });
});

describe("resolveBuilderCallbackWrite", () => {
  it("fails an org connect whose connector lost owner/admin instead of saving it personally", () => {
    expect(
      resolveBuilderCallbackWrite({
        requestedScope: "org",
        pendingOrgId: "org-123",
        pendingRole: "admin",
        currentOrg: { orgId: "org-123", role: "member" },
      }),
    ).toEqual({
      deny: "Only an organization owner or admin can change the shared Builder connection.",
    });
    expect(
      resolveBuilderCallbackWrite({
        requestedScope: "org",
        pendingOrgId: "org-123",
        pendingRole: "admin",
        currentOrg: { orgId: "org-other", role: "owner" },
      }),
    ).toHaveProperty("deny");
  });

  it("writes the org grant when the connector is still an owner or admin", () => {
    expect(
      resolveBuilderCallbackWrite({
        requestedScope: "org",
        pendingOrgId: "org-123",
        pendingRole: "owner",
        currentOrg: { orgId: "org-123", role: "owner" },
      }),
    ).toEqual({ scope: "org", role: "owner" });
  });

  it("writes a personal grant for a personal connect", () => {
    expect(
      resolveBuilderCallbackWrite({
        requestedScope: "personal",
        pendingOrgId: "org-123",
        pendingRole: "member",
        currentOrg: null,
      }),
    ).toEqual({ scope: "user", role: null });
  });

  it("keeps the role-decided write for connects that named no scope", () => {
    expect(
      resolveBuilderCallbackWrite({
        requestedScope: null,
        pendingOrgId: "org-123",
        pendingRole: "admin",
        currentOrg: { orgId: "org-123", role: "admin" },
      }),
    ).toEqual({ role: "admin" });
    expect(
      resolveBuilderCallbackWrite({
        requestedScope: null,
        pendingOrgId: "org-123",
        pendingRole: "admin",
        currentOrg: { orgId: "org-123", role: "member" },
      }),
    ).toEqual({ role: null });
  });
});

describe("disconnectBuilderConnectionAtScope", () => {
  function deps(
    overrides: Partial<BuilderScopedDisconnectDeps> = {},
  ): BuilderScopedDisconnectDeps {
    return {
      hasStoredGrant: vi.fn(async () => true),
      deleteGrant: vi.fn(async () => ({
        localDeleted: true,
        remoteRevoked: true,
      })),
      getKeyConnections: vi.fn(async () => ({})),
      deleteLegacy: vi.fn(async () => undefined),
      recordAudit: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it("removes only the caller's personal grant", async () => {
    const d = deps();
    await expect(
      disconnectBuilderConnectionAtScope(
        {
          email: "member@example.com",
          orgId: "org-123",
          role: "member",
          scope: "personal",
        },
        d,
      ),
    ).resolves.toEqual({
      status: 200,
      body: {
        ok: true,
        scope: "personal",
        remoteRevoked: true,
        warning: undefined,
      },
    });
    expect(d.deleteGrant).toHaveBeenCalledWith(
      "member@example.com",
      "user",
      "org-123",
    );
    expect(d.deleteLegacy).toHaveBeenCalledWith(
      "member@example.com",
      undefined,
    );
    expect(d.recordAudit).toHaveBeenCalledWith({
      connected: false,
      ownerEmail: "member@example.com",
      orgId: "org-123",
      scope: "user",
    });
  });

  it("requires owner/admin for the organization connection", async () => {
    const d = deps();
    await expect(
      disconnectBuilderConnectionAtScope(
        {
          email: "member@example.com",
          orgId: "org-123",
          role: "member",
          scope: "org",
        },
        d,
      ),
    ).resolves.toMatchObject({ status: 403 });
    expect(d.deleteGrant).not.toHaveBeenCalled();
    expect(d.deleteLegacy).not.toHaveBeenCalled();
    expect(d.recordAudit).not.toHaveBeenCalled();
  });

  it("removes the org grant and org-scoped legacy keys for an admin", async () => {
    const d = deps();
    await disconnectBuilderConnectionAtScope(
      {
        email: "admin@example.com",
        orgId: "org-123",
        role: "admin",
        scope: "org",
      },
      d,
    );
    expect(d.deleteGrant).toHaveBeenCalledWith(
      "admin@example.com",
      "org",
      "org-123",
    );
    expect(d.deleteLegacy).toHaveBeenCalledWith("admin@example.com", {
      orgId: "org-123",
      role: "admin",
    });
    expect(d.recordAudit).toHaveBeenCalledWith({
      connected: false,
      ownerEmail: "admin@example.com",
      orgId: "org-123",
      scope: "org",
    });
  });

  it("disconnects a legacy key connection at the named scope", async () => {
    const d = deps({
      hasStoredGrant: vi.fn(async () => false),
      getKeyConnections: vi.fn(async () => ({
        personal: { connectedAt: 1_000, needsReconnect: false },
      })),
    });
    await expect(
      disconnectBuilderConnectionAtScope(
        {
          email: "member@example.com",
          orgId: "org-123",
          role: "member",
          scope: "personal",
        },
        d,
      ),
    ).resolves.toMatchObject({ status: 200, body: { ok: true } });
    expect(d.deleteGrant).not.toHaveBeenCalled();
    expect(d.deleteLegacy).toHaveBeenCalled();
  });

  it("disconnects org keys even while the admin's own personal keys are in effect", async () => {
    const d = deps({
      hasStoredGrant: vi.fn(async () => false),
      getKeyConnections: vi.fn(async () => ({
        org: { connectedAt: 1_000, needsReconnect: false },
        personal: { connectedAt: 1_000, needsReconnect: false },
      })),
    });
    await expect(
      disconnectBuilderConnectionAtScope(
        {
          email: "admin@example.com",
          orgId: "org-123",
          role: "admin",
          scope: "org",
        },
        d,
      ),
    ).resolves.toMatchObject({ status: 200, body: { ok: true, scope: "org" } });
    expect(d.deleteLegacy).toHaveBeenCalledWith("admin@example.com", {
      orgId: "org-123",
      role: "admin",
    });
  });

  it("reports a missing connection instead of removing a different one", async () => {
    const d = deps({
      hasStoredGrant: vi.fn(async () => false),
      getKeyConnections: vi.fn(async () => ({
        org: { connectedAt: 1_000, needsReconnect: false },
      })),
    });
    await expect(
      disconnectBuilderConnectionAtScope(
        {
          email: "member@example.com",
          orgId: "org-123",
          role: "member",
          scope: "personal",
        },
        d,
      ),
    ).resolves.toEqual({
      status: 409,
      body: { error: "No personal Builder.io connection was found." },
    });
    expect(d.deleteLegacy).not.toHaveBeenCalled();
    expect(d.recordAudit).not.toHaveBeenCalled();
  });

  it("surfaces an unreadable credential store instead of calling it disconnected", async () => {
    const d = deps({
      hasStoredGrant: vi.fn(async () => false),
      getKeyConnections: vi.fn(async () => {
        throw new Error("Builder credentials could not be read");
      }),
    });
    await expect(
      disconnectBuilderConnectionAtScope(
        {
          email: "member@example.com",
          orgId: "org-123",
          role: "member",
          scope: "personal",
        },
        d,
      ),
    ).rejects.toThrow("could not be read");
  });
});

describe("selectLiveBuilderConnectStates", () => {
  const now = 1_000_000;
  const live = { expiresAt: now + 60_000 };

  it("drops consumed, expired, and missing flows", async () => {
    const rows: Record<string, Record<string, unknown> | null> = {
      "builder-connect-pending:live": live,
      "builder-connect-pending:consumed": { ...live, consumed: true },
      "builder-connect-pending:expired": { expiresAt: now - 1 },
      "builder-connect-pending:gone": null,
    };

    await expect(
      selectLiveBuilderConnectStates(
        ["live", "consumed", "expired", "gone"],
        now,
        (async (key: string) => rows[key] ?? null) as never,
      ),
    ).resolves.toEqual(["live"]);
  });

  it("reports an unreadable pending store instead of calling every flow dead", async () => {
    await expect(
      selectLiveBuilderConnectStates(["live"], now, (async () => {
        throw new Error("settings unavailable");
      }) as never),
    ).resolves.toBeNull();
  });

  it("recovers the one live flow when the cookie also holds a finished one", async () => {
    const finished = createBuilderConnectState();
    const pending = createBuilderConnectState();
    const cookie = appendBuilderConnectStateCookie(
      appendBuilderConnectStateCookie(null, finished),
      pending,
    );
    const rows: Record<string, Record<string, unknown> | null> = {
      [`builder-connect-pending:${pending}`]: live,
      [`builder-connect-pending:${finished}`]: { ...live, consumed: true },
    };

    const states = await selectLiveBuilderConnectStates(
      cookie.split(","),
      now,
      (async (key: string) => rows[key] ?? null) as never,
    );

    // Builder dropped the query state: the finished flow must not make this
    // callback look ambiguous.
    expect(
      resolveBuilderConnectCallbackState(null, (states ?? []).join(",")),
    ).toEqual({ state: pending, resetStateCookie: false });
  });

  it("still fails closed when two flows are genuinely live", async () => {
    const first = createBuilderConnectState();
    const second = createBuilderConnectState();
    const states = await selectLiveBuilderConnectStates(
      [first, second],
      now,
      (async () => live) as never,
    );

    expect(
      resolveBuilderConnectCallbackState(null, (states ?? []).join(",")),
    ).toEqual({ state: null, resetStateCookie: true });
  });
});
