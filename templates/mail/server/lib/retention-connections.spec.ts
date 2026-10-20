import { getRequestOrgId } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getConnectedAccountsWithErrors: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("./google-auth.js", () => ({
  getConnectedAccountsWithErrors: mocks.getConnectedAccountsWithErrors,
}));

import { resolveConnectedAccountsForRetention } from "./retention-connections.js";

const OWNER = "owner@example.com";
const MANAGED = "managed@example.com";

// Script the two table reads the resolver makes.
function tables(opts: { orgIds?: string[]; managed?: boolean }) {
  mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
    if (/FROM org_members/.test(sql)) {
      return { rows: (opts.orgIds ?? []).map((org_id) => ({ org_id })) };
    }
    return { rows: opts.managed ? [{ "?column?": 1 }] : [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnectedAccountsWithErrors.mockResolvedValue({
    accounts: [],
    errors: [],
  });
});

describe("resolveConnectedAccountsForRetention", () => {
  it("fails closed for a cron sweep with no org context and a managed connection", async () => {
    tables({ orgIds: [], managed: true });
    // Outside the owning org the managed connection resolves to nothing.
    const result = await resolveConnectedAccountsForRetention(OWNER);

    expect(result.verified).toBe(false);
    expect(result.accounts).toEqual([]);
  });

  it("finds a managed connection by running the lookup inside each of the owner's orgs", async () => {
    tables({ orgIds: ["org-a", "org-b"], managed: true });
    mocks.getConnectedAccountsWithErrors.mockImplementation(async () => ({
      accounts: getRequestOrgId() === "org-b" ? [MANAGED] : [],
      errors: [],
    }));

    const result = await resolveConnectedAccountsForRetention(OWNER);

    expect(result).toEqual({
      accounts: [MANAGED],
      errors: [],
      verified: true,
    });
    expect(mocks.getConnectedAccountsWithErrors).toHaveBeenCalledTimes(3);
  });

  it("verifies an owner with no managed connection and no accounts as disconnected", async () => {
    tables({ orgIds: [], managed: false });

    await expect(resolveConnectedAccountsForRetention(OWNER)).resolves.toEqual({
      accounts: [],
      errors: [],
      verified: true,
    });
  });

  it("is unverified when any org lookup reports an error", async () => {
    tables({ orgIds: ["org-a"], managed: false });
    mocks.getConnectedAccountsWithErrors.mockImplementation(async () => ({
      accounts: [],
      errors:
        getRequestOrgId() === "org-a"
          ? [{ email: "workspace", error: "managed lookup failed" }]
          : [],
    }));

    const result = await resolveConnectedAccountsForRetention(OWNER);

    expect(result.verified).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("is unverified when org membership cannot be read", async () => {
    mocks.execute.mockRejectedValue(new Error("connection reset"));

    const result = await resolveConnectedAccountsForRetention(OWNER);

    expect(result.verified).toBe(false);
    expect(mocks.getConnectedAccountsWithErrors).not.toHaveBeenCalled();
  });

  it("treats a deployment without org tables as personal-only", async () => {
    mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (/FROM org_members/.test(sql)) {
        throw new Error('relation "org_members" does not exist');
      }
      return { rows: [] };
    });

    const result = await resolveConnectedAccountsForRetention(OWNER);

    expect(result.verified).toBe(true);
    expect(mocks.getConnectedAccountsWithErrors).toHaveBeenCalledTimes(1);
  });
});
