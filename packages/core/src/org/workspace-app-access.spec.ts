import { afterEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  includeUser: vi.fn(),
  validateFederatedOrganizationMembershipForCurrentRequest: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));

vi.mock("../workspace-connections/groups.js", () => ({
  workspaceUserGroupsIncludeUser: (...args: unknown[]) =>
    mocks.includeUser(...args),
}));

vi.mock("./federation.js", () => ({
  validateFederatedOrganizationMembershipForCurrentRequest:
    mocks.validateFederatedOrganizationMembershipForCurrentRequest,
}));

import {
  __resetWorkspaceAppAccessCacheForTests,
  invalidateWorkspaceAppAccessCache,
} from "./workspace-app-access-cache.js";
import { isWorkspaceAppAccessAllowed } from "./workspace-app-access.js";

describe("isWorkspaceAppAccessAllowed", () => {
  afterEach(() => {
    __resetWorkspaceAppAccessCacheForTests();
    vi.unstubAllEnvs();
    resetAppConfigForTests();
    vi.unstubAllGlobals();
    mocks.execute.mockReset();
    mocks.includeUser.mockReset();
    mocks.validateFederatedOrganizationMembershipForCurrentRequest.mockReset();
  });

  it("allows the recorded owner in the app organization", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          owner_email: "Owner@Example.com",
          org_id: "org-1",
          visibility: "private",
        },
      ],
    });

    await expect(
      isWorkspaceAppAccessAllowed("analytics", {
        email: "owner@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);
  });

  it("denies the recorded owner when the organization disabled the app", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          owner_email: "Owner@Example.com",
          org_id: "org-1",
          visibility: "private",
          org_enabled: false,
        },
      ],
    });

    await expect(
      isWorkspaceAppAccessAllowed("analytics", {
        email: "owner@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(false);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("allows active organization members to access Dispatch", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ role: "member" }] });

    await expect(
      isWorkspaceAppAccessAllowed("dispatch", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);
  });

  it("denies Dispatch access when a linked member was removed upstream", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          role: "admin",
          identityAuthority: "https://identity.example.test",
          identityId: "org-1",
        },
      ],
    });
    mocks.validateFederatedOrganizationMembershipForCurrentRequest.mockResolvedValue(
      { active: false, role: null },
    );

    await expect(
      isWorkspaceAppAccessAllowed("dispatch", {
        email: "admin@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(false);
    expect(
      mocks.validateFederatedOrganizationMembershipForCurrentRequest,
    ).toHaveBeenCalledWith({
      orgId: "org-1",
      email: "admin@example.com",
    });
  });

  it("keeps standalone Dispatch available when its org schema is absent", async () => {
    vi.stubEnv("AGENT_NATIVE_APP_ID", "dispatch");
    resetAppConfigForTests();
    mocks.execute
      .mockRejectedValueOnce(new Error('relation "org_members" does not exist'))
      .mockRejectedValueOnce(
        new Error('relation "org_members" does not exist'),
      );

    await expect(
      isWorkspaceAppAccessAllowed("dispatch", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);
  });

  it("fails closed for hosted Dispatch when its org schema is absent", async () => {
    vi.stubEnv("AGENT_NATIVE_APP_ID", "dispatch");
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    resetAppConfigForTests();
    mocks.execute.mockRejectedValueOnce(
      new Error('relation "org_members" does not exist'),
    );

    await expect(
      isWorkspaceAppAccessAllowed("dispatch", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(false);
  });

  it("allows organization members for org-visible apps", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          {
            owner_email: "owner@example.com",
            org_id: "org-1",
            visibility: "org",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ role: "member" }] });

    await expect(
      isWorkspaceAppAccessAllowed("analytics", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);
  });

  it("allows a non-owner member to access a migrated ownerless legacy app", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          {
            owner_email: "",
            org_id: "org-1",
            visibility: "org",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ role: "member" }] });

    await expect(
      isWorkspaceAppAccessAllowed("legacy-app", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);
  });

  it("claims an ownerless org-visible app for the first active organization", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [{ owner_email: "", org_id: null, visibility: "org" }],
      })
      .mockResolvedValueOnce({ rows: [{ role: "owner" }] })
      .mockResolvedValueOnce({ rows: [{ org_id: "org-1" }] });

    await expect(
      isWorkspaceAppAccessAllowed("fresh-app", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);
    expect(mocks.execute).toHaveBeenLastCalledWith({
      sql: expect.stringContaining("UPDATE workspace_apps SET org_id = ?"),
      args: ["org-1", "fresh-app"],
    });
  });

  it("does not let a regular member claim an ownerless app", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [{ owner_email: "", org_id: null, visibility: "org" }],
      })
      .mockResolvedValueOnce({ rows: [{ role: "member" }] });

    await expect(
      isWorkspaceAppAccessAllowed("fresh-app", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(false);
  });

  it("denies an ownerless app when another organization wins the claim", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [{ owner_email: "", org_id: null, visibility: "org" }],
      })
      .mockResolvedValueOnce({ rows: [{ role: "admin" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ org_id: "org-1" }] });

    await expect(
      isWorkspaceAppAccessAllowed("fresh-app", {
        email: "member@example.com",
        orgId: "org-2",
      }),
    ).resolves.toBe(false);
  });

  it("allows an ownerless app when the same organization wins the claim race", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [{ owner_email: "", org_id: null, visibility: "org" }],
      })
      .mockResolvedValueOnce({ rows: [{ role: "admin" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ org_id: "org-1" }] });

    await expect(
      isWorkspaceAppAccessAllowed("fresh-app", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);
  });

  it("honors a group share for a private app", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          {
            owner_email: "owner@example.com",
            org_id: "org-1",
            visibility: "private",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ role: "member" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ principal_id: "gtm-team" }] });
    mocks.includeUser.mockResolvedValueOnce(true);

    await expect(
      isWorkspaceAppAccessAllowed("analytics", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);
    expect(mocks.includeUser).toHaveBeenCalledWith(
      "org-1",
      ["gtm-team"],
      "member@example.com",
    );
  });

  it("honors an explicit organization share for a private app", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          {
            owner_email: "owner@example.com",
            org_id: "org-1",
            visibility: "private",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ role: "member" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    await expect(
      isWorkspaceAppAccessAllowed("analytics", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);
    expect(mocks.includeUser).not.toHaveBeenCalled();
  });

  it("denies private apps outside the organization or without a share", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          {
            owner_email: "owner@example.com",
            org_id: "org-1",
            visibility: "private",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ role: "member" }] });

    await expect(
      isWorkspaceAppAccessAllowed("analytics", {
        email: "member@example.com",
        orgId: "org-2",
      }),
    ).resolves.toBe(false);

    mocks.execute.mockReset();
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          {
            owner_email: "owner@example.com",
            org_id: "org-1",
            visibility: "private",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ role: "member" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.includeUser.mockResolvedValueOnce(false);

    await expect(
      isWorkspaceAppAccessAllowed("analytics", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(false);
  });

  it("denies access when the local ACL record is missing", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });

    await expect(
      isWorkspaceAppAccessAllowed("unregistered", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(false);
  });

  it("uses the authoritative Dispatch registry when configured", async () => {
    vi.stubEnv("A2A_SECRET", "test-a2a-secret");
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "test-vercel-bypass");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "dispatch.example.test");
    vi.stubEnv(
      "AGENT_NATIVE_ORG_DIRECTORY_URL",
      "https://dispatch.example.test",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify([{ id: "allowed-app" }, { id: "another-app" }]),
          { headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      isWorkspaceAppAccessAllowed("allowed-app", {
        email: "member@example.com",
        orgId: null,
      }),
    ).resolves.toBe(true);
    await expect(
      isWorkspaceAppAccessAllowed("private-app", {
        email: "member@example.com",
        orgId: null,
      }),
    ).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://dispatch.example.test/_agent-native/actions/list-workspace-apps?includeAgentCards=false&audience=all",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: "application/json",
          Authorization: expect.stringMatching(/^Bearer /),
          "x-vercel-protection-bypass": "test-vercel-bypass",
        }),
      }),
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      "https://dispatch.example.test/_agent-native/actions/claim-workspace-app-organization",
    );
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ appId: "private-app" }),
      }),
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("asks Dispatch to claim a fresh hosted app", async () => {
    vi.stubEnv("A2A_SECRET", "test-a2a-secret");
    vi.stubEnv(
      "AGENT_NATIVE_ORG_DIRECTORY_URL",
      "https://dispatch.example.test",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ allowed: true }), {
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "fresh-app" }]), {
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      isWorkspaceAppAccessAllowed("fresh-app", {
        email: "owner@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://dispatch.example.test/_agent-native/actions/claim-workspace-app-organization",
    );
  });

  it("denies a disabled app reported by the authoritative hosted registry", async () => {
    vi.stubEnv("A2A_SECRET", "test-a2a-secret");
    vi.stubEnv(
      "AGENT_NATIVE_ORG_DIRECTORY_URL",
      "https://dispatch.example.test",
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: "analytics", orgEnabled: false }]), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      isWorkspaceAppAccessAllowed("analytics", {
        email: "owner@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors a local organization disable before hosted registry access", async () => {
    vi.stubEnv(
      "AGENT_NATIVE_ORG_DIRECTORY_URL",
      "https://dispatch.example.test",
    );
    resetAppConfigForTests();
    mocks.execute.mockResolvedValueOnce({ rows: [{ org_enabled: false }] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      isWorkspaceAppAccessAllowed("analytics", {
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  describe("hosted registry decision cache", () => {
    function stubHostedRegistry(apps: unknown[]) {
      vi.stubEnv("A2A_SECRET", "test-a2a-secret");
      vi.stubEnv(
        "AGENT_NATIVE_ORG_DIRECTORY_URL",
        "https://dispatch.example.test",
      );
      resetAppConfigForTests();
      mocks.execute.mockResolvedValue({ rows: [] });
      const fetchMock = vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify(apps), {
            headers: { "content-type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    const member = { email: "member@example.com", orgId: "org-1" };

    it("serves a repeated allow without asking the registry again", async () => {
      const fetchMock = stubHostedRegistry([{ id: "gtm" }]);

      await expect(isWorkspaceAppAccessAllowed("gtm", member)).resolves.toBe(
        true,
      );
      await expect(isWorkspaceAppAccessAllowed("gtm", member)).resolves.toBe(
        true,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("collapses a parallel page-load burst onto one registry call", async () => {
      const fetchMock = stubHostedRegistry([{ id: "gtm" }]);

      const results = await Promise.all(
        Array.from({ length: 15 }, () =>
          isWorkspaceAppAccessAllowed("gtm", member),
        ),
      );

      expect(results.every(Boolean)).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("keys decisions by user and organization", async () => {
      const fetchMock = stubHostedRegistry([{ id: "gtm" }]);

      await isWorkspaceAppAccessAllowed("gtm", member);
      await isWorkspaceAppAccessAllowed("gtm", {
        email: "other@example.com",
        orgId: "org-1",
      });
      await isWorkspaceAppAccessAllowed("gtm", {
        email: "member@example.com",
        orgId: "org-2",
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("does not cache a registry failure as a deny", async () => {
      const fetchMock = stubHostedRegistry([{ id: "gtm" }]);
      fetchMock.mockRejectedValueOnce(
        new DOMException("aborted", "AbortError"),
      );
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await expect(isWorkspaceAppAccessAllowed("gtm", member)).resolves.toBe(
        false,
      );
      await expect(isWorkspaceAppAccessAllowed("gtm", member)).resolves.toBe(
        true,
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      consoleError.mockRestore();
    });

    it("still honors a local organization disable after a cached allow", async () => {
      stubHostedRegistry([{ id: "gtm" }]);
      await expect(isWorkspaceAppAccessAllowed("gtm", member)).resolves.toBe(
        true,
      );

      mocks.execute.mockResolvedValueOnce({ rows: [{ org_enabled: false }] });

      await expect(isWorkspaceAppAccessAllowed("gtm", member)).resolves.toBe(
        false,
      );
    });

    it("aborts the registry call after the configured timeout", async () => {
      const fetchMock = stubHostedRegistry([{ id: "gtm" }]);
      vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_ACCESS_TIMEOUT_MS", "50");
      resetAppConfigForTests();
      let abortedAt: number | undefined;
      let fetchedAt: number | undefined;
      fetchMock.mockImplementationOnce(
        (_url: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            fetchedAt = Date.now();
            init?.signal?.addEventListener("abort", () => {
              abortedAt = Date.now();
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await expect(isWorkspaceAppAccessAllowed("gtm", member)).resolves.toBe(
        false,
      );

      expect(abortedAt).toBeDefined();
      expect(abortedAt! - fetchedAt!).toBeGreaterThanOrEqual(40);
      expect(abortedAt! - fetchedAt!).toBeLessThan(1_000);
      consoleError.mockRestore();
    });

    it("asks the registry again after invalidation", async () => {
      const fetchMock = stubHostedRegistry([{ id: "gtm" }]);

      await isWorkspaceAppAccessAllowed("gtm", member);
      await invalidateWorkspaceAppAccessCache();
      await isWorkspaceAppAccessAllowed("gtm", member);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
