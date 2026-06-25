import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listStrategicAccounts: vi.fn(),
  replaceStrategicAccounts: vi.fn(),
  updateStrategicAccount: vi.fn(),
  orgId: null as string | null,
  email: "alice@example.com" as string | null,
}));

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return { ...actual };
});

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(
    ({ app, view }: { app: string; view: string }) => `/${app}/${view}`,
  ),
  getRequestOrgId: () => mocks.orgId,
  getRequestUserEmail: () => mocks.email,
}));

vi.mock("../server/lib/strategic-accounts-store", () => ({
  listStrategicAccounts: mocks.listStrategicAccounts,
  replaceStrategicAccounts: mocks.replaceStrategicAccounts,
  updateStrategicAccount: mocks.updateStrategicAccount,
}));

const { default: listAction } = await import("./list-strategic-accounts");
const { default: upsertAction } = await import("./upsert-strategic-accounts");
const { default: updateAction } = await import("./update-strategic-account");

beforeEach(() => {
  mocks.listStrategicAccounts.mockReset();
  mocks.replaceStrategicAccounts.mockReset();
  mocks.updateStrategicAccount.mockReset();
  mocks.orgId = null;
  mocks.email = "alice@example.com";
});

describe("list-strategic-accounts", () => {
  it("returns accounts and a CSV of names for the dashboard variable", async () => {
    mocks.listStrategicAccounts.mockResolvedValue([
      { companyName: "Acme" },
      { companyName: "Globex" },
    ]);
    const result = (await listAction.run({})) as {
      count: number;
      accountsCsv: string;
    };
    expect(result.count).toBe(2);
    expect(result.accountsCsv).toBe("Acme,Globex");
    expect(mocks.listStrategicAccounts).toHaveBeenCalledWith({
      email: "alice@example.com",
      orgId: null,
    });
  });

  it("throws when unauthenticated", async () => {
    mocks.email = null;
    await expect(listAction.run({})).rejects.toThrow("no authenticated user");
  });
});

describe("upsert-strategic-accounts", () => {
  it("replaces the roster atomically and reports the new count", async () => {
    mocks.replaceStrategicAccounts.mockResolvedValue([
      { id: "1", companyName: "Acme" },
    ]);
    const result = (await upsertAction.run({
      accounts: [{ companyName: "Acme" }],
    })) as { ok: boolean; count: number };
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(mocks.replaceStrategicAccounts).toHaveBeenCalledWith(
      [{ companyName: "Acme" }],
      { email: "alice@example.com", orgId: null },
    );
  });

  it("accepts a JSON string for accounts", async () => {
    mocks.replaceStrategicAccounts.mockResolvedValue([]);
    await upsertAction.run({
      accounts: JSON.stringify([{ companyName: "Acme" }]) as any,
    });
    expect(mocks.replaceStrategicAccounts).toHaveBeenCalledWith(
      [{ companyName: "Acme" }],
      expect.anything(),
    );
  });
});

describe("update-strategic-account", () => {
  it("passes only the patch fields and returns the updated row", async () => {
    mocks.updateStrategicAccount.mockResolvedValue({
      id: "1",
      deploymentStatus: "Production",
    });
    const result = (await updateAction.run({
      id: "1",
      deploymentStatus: "Production",
    })) as { ok: boolean; account: { deploymentStatus: string } };
    expect(result.ok).toBe(true);
    expect(result.account.deploymentStatus).toBe("Production");
    expect(mocks.updateStrategicAccount).toHaveBeenCalledWith(
      "1",
      { deploymentStatus: "Production" },
      { email: "alice@example.com", orgId: null },
    );
  });

  it("throws when the row is missing or inaccessible", async () => {
    mocks.updateStrategicAccount.mockResolvedValue(null);
    await expect(
      updateAction.run({ id: "missing", notes: "x" }),
    ).rejects.toThrow(/not found/);
  });
});
