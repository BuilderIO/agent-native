import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
const mockGetUserSetting = vi.fn();

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({ execute: mockExecute }),
  isPostgres: () => false,
  isLocalDatabase: () => true,
}));
vi.mock("../server/auth.js", () => ({ getSession: vi.fn() }));
vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: (...args: any[]) => mockGetUserSetting(...args),
  putUserSetting: vi.fn(),
}));
vi.mock("../settings/store.js", () => ({ getSetting: vi.fn() }));

import { runWithRequestContext } from "../server/request-context.js";
import { createOrganization, resolveOrgIdForEmail } from "./context.js";

function memberRowQueries() {
  return mockExecute.mock.calls.filter((c) =>
    String(c[0]?.sql ?? "").includes("SELECT org_id FROM org_members"),
  );
}

describe("per-request org membership memo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rows: [] });
    mockGetUserSetting.mockResolvedValue(null);
  });

  it("reads org_members once for repeated resolutions in one request", async () => {
    mockExecute.mockResolvedValue({ rows: [{ org_id: "org1" }] });

    const results = await runWithRequestContext(
      { userEmail: "alice@builder.io" },
      async () => [
        await resolveOrgIdForEmail("alice@builder.io"),
        await resolveOrgIdForEmail("alice@builder.io"),
        await resolveOrgIdForEmail("Alice@Builder.IO"),
      ],
    );

    expect(results).toEqual(["org1", "org1", "org1"]);
    expect(memberRowQueries()).toHaveLength(1);
  });

  it("never answers one identity with another's memberships", async () => {
    mockExecute.mockImplementation(async (q: any) =>
      q.args?.[0] === "alice@builder.io"
        ? { rows: [{ org_id: "org-alice" }] }
        : { rows: [{ org_id: "org-bob" }] },
    );

    const [alice, bob] = await runWithRequestContext(
      { userEmail: "alice@builder.io" },
      async () => [
        await resolveOrgIdForEmail("alice@builder.io"),
        await resolveOrgIdForEmail("bob@builder.io"),
      ],
    );

    expect(alice).toBe("org-alice");
    expect(bob).toBe("org-bob");
    expect(memberRowQueries()).toHaveLength(2);
  });

  it("does not share a cached value across two requests", async () => {
    mockExecute.mockResolvedValue({ rows: [{ org_id: "org-first" }] });
    const first = await runWithRequestContext(
      { userEmail: "alice@builder.io" },
      () => resolveOrgIdForEmail("alice@builder.io"),
    );

    mockExecute.mockResolvedValue({ rows: [{ org_id: "org-second" }] });
    const second = await runWithRequestContext(
      { userEmail: "alice@builder.io" },
      () => resolveOrgIdForEmail("alice@builder.io"),
    );

    expect(first).toBe("org-first");
    expect(second).toBe("org-second");
    expect(memberRowQueries()).toHaveLength(2);
  });

  it("re-reads memberships after a membership write in the same request", async () => {
    mockExecute.mockResolvedValue({ rows: [] });

    const after = await runWithRequestContext(
      { userEmail: "alice@builder.io" },
      async () => {
        expect(await resolveOrgIdForEmail("alice@builder.io")).toBeNull();
        mockExecute.mockResolvedValue({ rows: [{ org_id: "org-new" }] });
        await createOrganization("New workspace", "alice@builder.io");
        return resolveOrgIdForEmail("alice@builder.io");
      },
    );

    expect(after).toBe("org-new");
    expect(memberRowQueries()).toHaveLength(2);
  });

  it("re-reads the active-org setting on every resolution", async () => {
    mockExecute.mockResolvedValue({
      rows: [{ org_id: "org1" }, { org_id: "org2" }],
    });
    mockGetUserSetting.mockResolvedValueOnce({ orgId: "org1" });
    mockGetUserSetting.mockResolvedValueOnce({ orgId: "org2" });

    const results = await runWithRequestContext(
      { userEmail: "alice@builder.io" },
      async () => [
        await resolveOrgIdForEmail("alice@builder.io"),
        await resolveOrgIdForEmail("alice@builder.io"),
      ],
    );

    expect(results).toEqual(["org1", "org2"]);
  });

  it("evicts a transient failure instead of memoizing it", async () => {
    // 08006 = connection failure; `queryOrgMembers` rethrows transient errors
    // rather than reporting them as "no memberships".
    mockExecute.mockRejectedValueOnce(
      Object.assign(new Error("connection failure"), { code: "08006" }),
    );

    const result = await runWithRequestContext(
      { userEmail: "alice@builder.io" },
      async () => {
        await expect(
          resolveOrgIdForEmail("alice@builder.io"),
        ).rejects.toThrow();
        mockExecute.mockResolvedValue({ rows: [{ org_id: "org1" }] });
        return resolveOrgIdForEmail("alice@builder.io");
      },
    );

    expect(result).toBe("org1");
    expect(memberRowQueries()).toHaveLength(2);
  });
});
