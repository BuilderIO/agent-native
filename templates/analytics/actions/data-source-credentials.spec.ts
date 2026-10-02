import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteCredential: vi.fn(),
  deleteResolvedCredential: vi.fn(),
  getScopedSettingRecord: vi.fn(),
  hasCredential: vi.fn(),
  loadDashboardSeed: vi.fn(),
  putScopedSettingRecord: vi.fn(),
  resolveOrgRole: vi.fn(),
  resolveRequestScope: vi.fn(),
  saveCredential: vi.fn(),
  tryRequestCredentialContext: vi.fn(),
}));
const mockTrack = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("../server/lib/db-admin-connections", () => ({
  resolveOrgRole: mocks.resolveOrgRole,
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: mockTrack,
}));

vi.mock("../server/lib/credentials", () => ({
  deleteCredential: mocks.deleteCredential,
  deleteResolvedCredential: mocks.deleteResolvedCredential,
  hasCredential: mocks.hasCredential,
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
    mocks.deleteResolvedCredential.mockReset();
    mocks.getScopedSettingRecord.mockReset();
    mocks.hasCredential.mockReset();
    mocks.loadDashboardSeed.mockReset();
    mocks.putScopedSettingRecord.mockReset();
    mocks.resolveOrgRole.mockReset();
    mocks.resolveRequestScope.mockReset();
    mocks.saveCredential.mockReset();
    mocks.tryRequestCredentialContext.mockReset();
    mockTrack.mockReset();

    mocks.tryRequestCredentialContext.mockReturnValue({
      userEmail: "ada@example.com",
      orgId: "org-1",
    });
    mocks.resolveRequestScope.mockReturnValue({
      email: "ada@example.com",
      orgId: "org-1",
    });
    mocks.getScopedSettingRecord.mockResolvedValue(null);
    mocks.hasCredential.mockResolvedValue(false);
    mocks.loadDashboardSeed.mockReturnValue({ panels: [] });
    mocks.resolveOrgRole.mockResolvedValue("member");
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
        scope: "user",
      },
    );
    expect(mocks.saveCredential).toHaveBeenCalledWith(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      serviceAccountJson,
      {
        userEmail: "ada@example.com",
        orgId: "org-1",
        scope: "user",
      },
    );
    expect(mocks.putScopedSettingRecord).toHaveBeenCalledWith(
      { email: "ada@example.com", orgId: "org-1" },
      "sql-dashboard-google-analytics",
      { panels: [] },
    );
  });

  it("tracks a connector only when credentials complete its required set", async () => {
    const savedKeys = new Set<string>();
    mocks.saveCredential.mockImplementation(async (key: string) => {
      savedKeys.add(key);
    });
    mocks.hasCredential.mockImplementation(async (key: string) =>
      savedKeys.has(key),
    );

    const vars = [
      { key: "GA4_PROPERTY_ID", value: "1234" },
      {
        key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        value: JSON.stringify({
          type: "service_account",
          private_key: "private-key",
          client_email: "service@example.iam.gserviceaccount.com",
        }),
      },
    ];

    await updateDataSourceCredentials.run({ vars });
    await updateDataSourceCredentials.run({ vars });

    expect(mockTrack).toHaveBeenCalledTimes(2);
    expect(mockTrack).toHaveBeenNthCalledWith(
      1,
      "connector_added",
      expect.objectContaining({ connector_name: "google-analytics" }),
      undefined,
    );
    expect(mockTrack).toHaveBeenNthCalledWith(
      2,
      "connector_added",
      expect.objectContaining({ connector_name: "gcloud" }),
      undefined,
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
    expect(mocks.deleteResolvedCredential).toHaveBeenCalledTimes(1);
    expect(mocks.deleteResolvedCredential).toHaveBeenCalledWith(
      "GA4_PROPERTY_ID",
      {
        userEmail: "ada@example.com",
        orgId: "org-1",
      },
    );
  });
  describe("where a saved credential lands", () => {
    const vars = [{ key: "GA4_PROPERTY_ID", value: "1234" }];
    const savedScopes = () =>
      mocks.saveCredential.mock.calls.map(([, , ctx]) => ctx.scope);

    it.each(["owner", "admin"])(
      "saves an %s's credential for the organization by default",
      async (role) => {
        mocks.resolveOrgRole.mockResolvedValue(role);
        await updateDataSourceCredentials.run({ vars });
        expect(mocks.saveCredential).toHaveBeenCalledWith(
          "GA4_PROPERTY_ID",
          "1234",
          { userEmail: "ada@example.com", orgId: "org-1", scope: "org" },
        );
      },
    );

    it("saves an admin's credential personally when they choose Personal", async () => {
      mocks.resolveOrgRole.mockResolvedValue("admin");
      await updateDataSourceCredentials.run({ vars, scope: "user" });
      expect(savedScopes()).toEqual(["user"]);
    });

    it("saves a member's credential personally by default", async () => {
      await updateDataSourceCredentials.run({ vars });
      expect(savedScopes()).toEqual(["user"]);
    });

    it("saves personally without an organization", async () => {
      mocks.tryRequestCredentialContext.mockReturnValue({
        userEmail: "ada@example.com",
        orgId: null,
      });
      await updateDataSourceCredentials.run({ vars });
      expect(savedScopes()).toEqual(["user"]);
      expect(mocks.resolveOrgRole).not.toHaveBeenCalled();
    });

    it("refuses a member's organization save with a 403 and writes nothing", async () => {
      await expect(
        updateDataSourceCredentials.run({ vars, scope: "org" }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mocks.saveCredential).not.toHaveBeenCalled();
    });

    it("fails instead of saving personally when the role cannot be read", async () => {
      mocks.resolveOrgRole.mockRejectedValue(new Error("role read failed"));
      await expect(updateDataSourceCredentials.run({ vars })).rejects.toThrow(
        "role read failed",
      );
      expect(mocks.saveCredential).not.toHaveBeenCalled();
    });
  });

  describe("clearing an optional key on save", () => {
    const vars = [
      { key: "BIGQUERY_PROJECT_ID", value: "example-project" },
      { key: "ANALYTICS_BIGQUERY_EVENTS_TABLE", value: "" },
    ];

    it("clears an owner's Personal value, never the organization's", async () => {
      mocks.resolveOrgRole.mockResolvedValue("owner");
      await updateDataSourceCredentials.run({ vars, scope: "user" });
      expect(mocks.deleteCredential).toHaveBeenCalledWith(
        "ANALYTICS_BIGQUERY_EVENTS_TABLE",
        { userEmail: "ada@example.com", orgId: "org-1", scope: "user" },
      );
      expect(mocks.deleteResolvedCredential).not.toHaveBeenCalled();
    });

    it("clears the organization's value when an admin saves for it", async () => {
      mocks.resolveOrgRole.mockResolvedValue("admin");
      await updateDataSourceCredentials.run({ vars });
      expect(mocks.deleteCredential).toHaveBeenCalledWith(
        "ANALYTICS_BIGQUERY_EVENTS_TABLE",
        { userEmail: "ada@example.com", orgId: "org-1", scope: "org" },
      );
    });

    it("refuses a member's organization clear and deletes nothing", async () => {
      await expect(
        updateDataSourceCredentials.run({ vars, scope: "org" }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mocks.deleteCredential).not.toHaveBeenCalled();
      expect(mocks.deleteResolvedCredential).not.toHaveBeenCalled();
    });
  });

  describe("disconnect removes the credential the reader uses", () => {
    it("removes each key through the resolver's own delete", async () => {
      await deleteDataSourceCredentials.run({ keys: ["GA4_PROPERTY_ID"] });
      expect(mocks.deleteResolvedCredential).toHaveBeenCalledWith(
        "GA4_PROPERTY_ID",
        { userEmail: "ada@example.com", orgId: "org-1" },
      );
    });

    it("refuses a member's removal of the organization's credential", async () => {
      mocks.deleteResolvedCredential.mockRejectedValue(
        Object.assign(new Error("owners and admins only"), {
          statusCode: 403,
        }),
      );
      await expect(
        deleteDataSourceCredentials.run({ keys: ["GA4_PROPERTY_ID"] }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });
});
