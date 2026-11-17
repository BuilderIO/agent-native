import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appStateGet: vi.fn(),
  appStateGetMany: vi.fn(),
  resolveCredential: vi.fn(),
  saveCredential: vi.fn(),
  deleteCredential: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  appStateGet: mocks.appStateGet,
  appStateGetMany: mocks.appStateGetMany,
}));
vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: mocks.resolveCredential,
  saveCredential: mocks.saveCredential,
  deleteCredential: mocks.deleteCredential,
}));
vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
}));

import {
  integrationContextFor,
  readIntegrationKey,
  readIntegrationStatuses,
  readLegacyIntegrationKey,
  saveIntegrationKey,
  deleteIntegrationKey,
} from "./integration-keys";

const ctx = { userEmail: "user@example.com", orgId: "org-1" };

describe("integration keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCredential.mockResolvedValue(undefined);
    mocks.appStateGet.mockResolvedValue(null);
  });

  it("saves to the credential store at user scope and never writes application state", async () => {
    await saveIntegrationKey("apollo", "example-apollo-key", ctx);

    expect(mocks.saveCredential).toHaveBeenCalledWith(
      "APOLLO_API_KEY",
      "example-apollo-key",
      { ...ctx, scope: "user" },
    );
    expect(mocks.appStateGet).not.toHaveBeenCalled();
  });

  it("saves HubSpot under the token HubSpot's provider API runtime resolves", async () => {
    await saveIntegrationKey("hubspot", "example-hubspot-key", ctx);

    expect(mocks.saveCredential).toHaveBeenCalledWith(
      "HUBSPOT_PRIVATE_APP_TOKEN",
      "example-hubspot-key",
      { ...ctx, scope: "user" },
    );
  });

  it("deletes only the user-scope credential row", async () => {
    await deleteIntegrationKey("pylon", ctx);

    expect(mocks.deleteCredential).toHaveBeenCalledWith("PYLON_API_KEY", {
      ...ctx,
      scope: "user",
    });
  });

  it("prefers the credential store and does not read the legacy row", async () => {
    mocks.resolveCredential.mockResolvedValue("stored-key");

    await expect(readIntegrationKey("gong", ctx)).resolves.toBe("stored-key");

    expect(mocks.resolveCredential).toHaveBeenCalledWith("GONG_API_KEY", ctx);
    expect(mocks.appStateGet).not.toHaveBeenCalled();
  });

  it("falls back to the legacy application-state row for an existing connection", async () => {
    mocks.appStateGet.mockResolvedValue({ apiKey: "legacy-key" });

    await expect(readIntegrationKey("pylon", ctx)).resolves.toBe("legacy-key");

    expect(mocks.appStateGet).toHaveBeenCalledWith("user@example.com", "pylon");
  });

  it("reports no key when neither store has one, including a blank legacy value", async () => {
    mocks.appStateGet.mockResolvedValue({ apiKey: "   " });

    await expect(readIntegrationKey("apollo", ctx)).resolves.toBeUndefined();
  });

  it("reads the shared local legacy bucket when nobody is signed in", async () => {
    mocks.appStateGet.mockResolvedValue({ apiKey: "local-key" });

    await expect(readIntegrationKey("gong", null)).resolves.toBe("local-key");

    expect(mocks.resolveCredential).not.toHaveBeenCalled();
    expect(mocks.appStateGet).toHaveBeenCalledWith("local", "gong");
  });

  it("does not hide a credential store failure as a missing key", async () => {
    mocks.resolveCredential.mockRejectedValue(new Error("store unreadable"));

    await expect(readIntegrationKey("apollo", ctx)).rejects.toThrow(
      "store unreadable",
    );
    expect(mocks.appStateGet).not.toHaveBeenCalled();
  });

  it("reads only the legacy row for the legacy fallback helper", async () => {
    mocks.appStateGet.mockResolvedValue({ apiKey: "legacy-key" });

    await expect(
      readLegacyIntegrationKey("hubspot", "user@example.com"),
    ).resolves.toBe("legacy-key");
    expect(mocks.resolveCredential).not.toHaveBeenCalled();
  });

  it("reports a provider connected from either store without returning a key", async () => {
    mocks.appStateGetMany.mockResolvedValue({
      apollo: { apiKey: "legacy-apollo-key" },
      hubspot: null,
      gong: null,
      pylon: null,
    });
    mocks.resolveCredential.mockImplementation(async (key: string) =>
      key === "HUBSPOT_PRIVATE_APP_TOKEN" ? "stored-hubspot-key" : undefined,
    );

    const statuses = await readIntegrationStatuses(ctx);

    expect(statuses).toEqual({
      apollo: true,
      hubspot: true,
      gong: false,
      pylon: false,
    });
    expect(JSON.stringify(statuses)).not.toContain("key");
  });

  it("resolves the credential context from the session", async () => {
    mocks.getSession.mockResolvedValue({
      email: "user@example.com",
      orgId: "org-1",
    });
    await expect(integrationContextFor({} as never)).resolves.toEqual(ctx);

    mocks.getSession.mockResolvedValue(null);
    await expect(integrationContextFor({} as never)).resolves.toBeNull();
  });
});
