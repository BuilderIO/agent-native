import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteCredential: vi.fn(),
  getScopedSettingRecord: vi.fn(),
  loadDashboardSeed: vi.fn(),
  putScopedSettingRecord: vi.fn(),
  resolveRequestScope: vi.fn(),
  saveCredential: vi.fn(),
  tryRequestCredentialContext: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("../server/lib/credentials", () => ({
  deleteCredential: mocks.deleteCredential,
  saveCredential: mocks.saveCredential,
}));

vi.mock("../server/lib/credentials-context", () => ({
  tryRequestCredentialContext: mocks.tryRequestCredentialContext,
}));

vi.mock("../server/lib/dashboard-seeds", () => ({
  loadDashboardSeed: mocks.loadDashboardSeed,
}));

vi.mock("../server/lib/scoped-settings", () => ({
  getScopedSettingRecord: mocks.getScopedSettingRecord,
  putScopedSettingRecord: mocks.putScopedSettingRecord,
  resolveRequestScope: mocks.resolveRequestScope,
}));

const { default: deleteDataSourceCredentials } =
  await import("./delete-data-source-credentials");
const { default: updateDataSourceCredentials } =
  await import("./update-data-source-credentials");

describe("data source credential actions", () => {
  beforeEach(() => {
    mocks.deleteCredential.mockReset();
    mocks.getScopedSettingRecord.mockReset();
    mocks.loadDashboardSeed.mockReset();
    mocks.putScopedSettingRecord.mockReset();
    mocks.resolveRequestScope.mockReset();
    mocks.saveCredential.mockReset();
    mocks.tryRequestCredentialContext.mockReset();

    mocks.tryRequestCredentialContext.mockReturnValue({
      userEmail: "ada@example.com",
      orgId: "org-1",
    });
    mocks.resolveRequestScope.mockReturnValue({
      email: "ada@example.com",
      orgId: "org-1",
    });
    mocks.getScopedSettingRecord.mockResolvedValue(null);
    mocks.loadDashboardSeed.mockReturnValue({ panels: [] });
  });

  it("saves recognized credentials and seeds the GA dashboard through action scope", async () => {
    const serviceAccountJson = JSON.stringify({
      type: "service_account",
      private_key: "private-key",
      client_email: "service@example.iam.gserviceaccount.com",
    });

    const result = (await updateDataSourceCredentials.run({
      vars: [
        { key: "NOPE", value: "ignored" },
        { key: "GA4_PROPERTY_ID", value: "1234" },
        {
          key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          value: serviceAccountJson,
        },
      ],
    })) as Record<string, unknown>;

    expect(result).toEqual({
      saved: ["GA4_PROPERTY_ID", "GOOGLE_APPLICATION_CREDENTIALS_JSON"],
      deleted: [],
    });
    expect(mocks.saveCredential).toHaveBeenCalledWith(
      "GA4_PROPERTY_ID",
      "1234",
      {
        userEmail: "ada@example.com",
        orgId: "org-1",
      },
    );
    expect(mocks.saveCredential).toHaveBeenCalledWith(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      serviceAccountJson,
      {
        userEmail: "ada@example.com",
        orgId: "org-1",
      },
    );
    expect(mocks.putScopedSettingRecord).toHaveBeenCalledWith(
      { email: "ada@example.com", orgId: "org-1" },
      "sql-dashboard-google-analytics",
      { panels: [] },
    );
  });

  it("rejects OAuth client JSON before saving service account credentials", async () => {
    await expect(
      updateDataSourceCredentials.run({
        vars: [
          {
            key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
            value: JSON.stringify({ web: {} }),
          },
        ],
      }),
    ).rejects.toThrow("not a service account key");

    expect(mocks.saveCredential).not.toHaveBeenCalled();
  });

  it("deletes only recognized credentials", async () => {
    const result = (await deleteDataSourceCredentials.run({
      keys: ["NOPE", "GA4_PROPERTY_ID"],
    })) as Record<string, unknown>;

    expect(result).toEqual({ deleted: ["GA4_PROPERTY_ID"] });
    expect(mocks.deleteCredential).toHaveBeenCalledTimes(1);
    expect(mocks.deleteCredential).toHaveBeenCalledWith("GA4_PROPERTY_ID", {
      userEmail: "ada@example.com",
      orgId: "org-1",
    });
  });
});
