import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  includeUser: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));

vi.mock("../workspace-connections/groups.js", () => ({
  workspaceUserGroupsIncludeUser: (...args: unknown[]) =>
    mocks.includeUser(...args),
}));

import { isWorkspaceAppAccessAllowed } from "./workspace-app-access.js";

describe("isWorkspaceAppAccessAllowed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mocks.execute.mockReset();
    mocks.includeUser.mockReset();
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://dispatch.example.test/_agent-native/actions/list-workspace-apps?includeAgentCards=false&audience=all",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: "application/json",
          Authorization: expect.stringMatching(/^Bearer /),
        }),
      }),
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
