import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: "admin",
  store: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async (orgId: string, key: string) =>
    m.store.get(`${orgId}:${key}`) ?? null,
  putOrgSetting: async (
    orgId: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    m.store.set(`${orgId}:${key}`, value);
  },
}));

vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => ({
    ownerEmail: "owner@example.test",
    orgId: "org-a",
    access: { orgRole: m.role },
  }),
  isWorkspaceAdministrator: (current: { access: { orgRole: string } }) =>
    current.access.orgRole === "owner" || current.access.orgRole === "admin",
}));

import getGitIntegrations from "./get-git-integrations";
import saveGitIntegrations from "./save-git-integrations";

describe("row 462: Git integrations settings actions", () => {
  beforeEach(() => {
    m.role = "admin";
    m.store.clear();
  });

  it("returns empty defaults until an admin configures Git integrations", async () => {
    expect(await getGitIntegrations.run({})).toEqual({
      packageImports: [],
      projectExports: [],
      repoSyncs: [],
    });
  });

  it("persists package imports, project exports, and repo syncs", async () => {
    const payload = {
      packageImports: [
        {
          id: "pkg-1",
          provider: "github" as const,
          repository: "acme/analytics-packages",
          branch: "main",
          subdir: "packages/sql",
          createdAt: "2026-11-22T00:00:00.000Z",
        },
      ],
      projectExports: [
        {
          id: "exp-1",
          provider: "gitlab" as const,
          repository: "acme/project-exports",
          branch: "release",
          directory: "notebooks",
          exportOnPublish: true,
          createdAt: "2026-11-22T00:00:00.000Z",
        },
      ],
      repoSyncs: [
        {
          id: "sync-1",
          provider: "bitbucket" as const,
          repository: "acme/workspace-sync",
          branch: "main",
          enabled: true,
          createdAt: "2026-11-22T00:00:00.000Z",
        },
      ],
    };
    await saveGitIntegrations.run(payload);
    expect(await getGitIntegrations.run({})).toEqual(payload);
  });

  it("rejects invalid repository slugs, path traversal, and duplicates", () => {
    expect(
      saveGitIntegrations.schema.safeParse({
        packageImports: [
          {
            id: "pkg-bad",
            provider: "github",
            repository: "https://token@github.com/acme/repo",
            branch: "main",
            subdir: "",
            createdAt: "2026-11-22T00:00:00.000Z",
          },
        ],
        projectExports: [],
        repoSyncs: [],
      }).success,
    ).toBe(false);

    expect(
      saveGitIntegrations.schema.safeParse({
        packageImports: [
          {
            id: "pkg-bad-dir",
            provider: "github",
            repository: "acme/repo",
            branch: "main",
            subdir: "../secrets",
            createdAt: "2026-11-22T00:00:00.000Z",
          },
        ],
        projectExports: [],
        repoSyncs: [],
      }).success,
    ).toBe(false);

    expect(
      saveGitIntegrations.schema.safeParse({
        packageImports: [],
        projectExports: [],
        repoSyncs: [
          {
            id: "sync-1",
            provider: "github",
            repository: "acme/repo",
            branch: "main",
            enabled: true,
            createdAt: "2026-11-22T00:00:00.000Z",
          },
          {
            id: "sync-2",
            provider: "github",
            repository: "ACME/repo",
            branch: "main",
            enabled: false,
            createdAt: "2026-11-22T00:01:00.000Z",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("refuses non-admin members and leaves storage untouched", async () => {
    m.role = "member";
    await expect(
      saveGitIntegrations.run({
        packageImports: [],
        projectExports: [],
        repoSyncs: [
          {
            id: "sync-1",
            provider: "github",
            repository: "acme/repo",
            branch: "main",
            enabled: true,
            createdAt: "2026-11-22T00:00:00.000Z",
          },
        ],
      }),
    ).rejects.toThrow(/owners and admins/);
    expect(m.store.size).toBe(0);
  });
});
