import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
const mockGetUserSetting = vi.fn();

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({ execute: mockExecute }),
  isLocalDatabase: () => true,
}));
vi.mock("../server/auth.js", () => ({ getSession: vi.fn() }));
vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: (...args: any[]) => mockGetUserSetting(...args),
  putUserSetting: vi.fn(),
}));
vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: vi.fn(),
}));

import { runWithRequestContext } from "../server/request-context.js";
import { createOrganization, resolveOrgIdForEmail } from "./context.js";
import {
  __resetProcessMemberOrgCacheForTests,
  cachedActiveOrgSetting,
  invalidateActiveOrgSettingCache,
  orgSelectionFromCookieHeader,
} from "./request-org-cache.js";

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

describe("cross-request active-org preference cache", () => {
  let now = 1_000_000;

  beforeEach(() => {
    __resetProcessMemberOrgCacheForTests();
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses a read, including an absent preference, until the TTL passes", async () => {
    const load = vi.fn(async () => null);

    await cachedActiveOrgSetting("Alice@Builder.IO", "", load);
    await cachedActiveOrgSetting("alice@builder.io", "", load);
    expect(load).toHaveBeenCalledTimes(1);

    now += 15_001;
    await cachedActiveOrgSetting("alice@builder.io", "", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("re-reads after a write invalidates it", async () => {
    const load = vi
      .fn<() => Promise<{ orgId: string | null } | null>>()
      .mockResolvedValueOnce({ orgId: "org-before" })
      .mockResolvedValueOnce({ orgId: "org-after" });

    await expect(
      cachedActiveOrgSetting("alice@builder.io", "", load),
    ).resolves.toEqual({
      orgId: "org-before",
    });
    invalidateActiveOrgSettingCache();
    await expect(
      cachedActiveOrgSetting("alice@builder.io", "", load),
    ).resolves.toEqual({
      orgId: "org-after",
    });
  });

  it("does not keep a read that raced a write", async () => {
    let finishRead!: (value: { orgId: string }) => void;
    const racing = cachedActiveOrgSetting(
      "alice@builder.io",
      "",
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    invalidateActiveOrgSettingCache();
    finishRead({ orgId: "org-before-switch" });
    await racing;

    const load = vi.fn(async () => ({ orgId: "org-after-switch" }));
    await expect(
      cachedActiveOrgSetting("alice@builder.io", "", load),
    ).resolves.toEqual({
      orgId: "org-after-switch",
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps each org selection's answer apart", async () => {
    const before = vi.fn(async () => ({ orgId: "org-before-switch" }));
    const after = vi.fn(async () => ({ orgId: "org-after-switch" }));
    const switched = "rotated-selection-0123456789";

    await cachedActiveOrgSetting("alice@builder.io", "", before);
    await expect(
      cachedActiveOrgSetting("alice@builder.io", switched, after),
    ).resolves.toEqual({ orgId: "org-after-switch" });
    await expect(
      cachedActiveOrgSetting("alice@builder.io", switched, before),
    ).resolves.toEqual({ orgId: "org-after-switch" });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("reads the selection only from a well-formed cookie", () => {
    expect(
      orgSelectionFromCookieHeader(
        "an_session=abc; an_org_selection=rotated-selection-0123456789",
      ),
    ).toBe("rotated-selection-0123456789");
    expect(orgSelectionFromCookieHeader("an_org_selection=short")).toBe("");
    expect(
      orgSelectionFromCookieHeader("an_org_selection=has:a:colon:0123456789"),
    ).toBe("");
    expect(orgSelectionFromCookieHeader(null)).toBe("");
  });

  it("changes the key when either of two copies rotates", () => {
    const older = "an_org_selection=unpartitioned-copy-0123456789";
    const key = (partitioned: string) =>
      orgSelectionFromCookieHeader(
        `${older}; an_session=abc; an_org_selection=${partitioned}`,
      );

    expect(key("partitioned-before-0123456789")).not.toBe(
      key("partitioned-after-0123456789"),
    );
    expect(key("partitioned-after-0123456789")).toContain(
      "partitioned-after-0123456789",
    );
  });

  it("never caches a failed read", async () => {
    const failure = new Error("settings unreadable");
    await expect(
      cachedActiveOrgSetting("alice@builder.io", "", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    const load = vi.fn(async () => ({ orgId: "org1" }));
    await cachedActiveOrgSetting("alice@builder.io", "", load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
