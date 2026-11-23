import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  writeAppState: vi.fn(),
  mutateUserSetting: vi.fn(),
  isConnected: vi.fn(),
  gmailListLabels: vi.fn(),
  gmailCreateLabel: vi.fn(),
  addCachedGmailLabel: vi.fn(),
  getClientsWithErrors: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));
vi.mock("@agent-native/core/settings", () => ({
  mutateUserSetting: mocks.mutateUserSetting,
}));
vi.mock("../server/lib/google-api.js", () => ({
  gmailListLabels: mocks.gmailListLabels,
  gmailCreateLabel: mocks.gmailCreateLabel,
}));
vi.mock("../server/lib/google-auth.js", () => ({
  getClientsWithErrors: mocks.getClientsWithErrors,
  isConnected: mocks.isConnected,
}));
vi.mock("../server/lib/inbox-store.js", () => ({
  addCachedGmailLabel: mocks.addCachedGmailLabel,
}));

import action from "./create-label";

describe("create-label action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.writeAppState.mockResolvedValue(undefined);
    mocks.addCachedGmailLabel.mockResolvedValue(undefined);
  });

  it("reuses a label an account already has, creates it where it is missing, and reports an account it cannot reach", async () => {
    mocks.isConnected.mockResolvedValue(true);
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        { email: "has@example.com", accessToken: "has-token" },
        { email: "missing@example.com", accessToken: "missing-token" },
      ],
      errors: [{ email: "expired@example.com", error: "invalid_grant" }],
    });
    mocks.gmailListLabels.mockImplementation(async (token) => ({
      labels:
        token === "has-token" ? [{ id: "Label_7", name: "Receipts" }] : [],
    }));
    mocks.gmailCreateLabel.mockResolvedValue({
      id: "Label_9",
      name: "receipts",
      type: "user",
    });

    const result = await action.run({ name: "receipts" });

    expect(result).toEqual({
      status: "partial",
      backend: "gmail",
      label: { id: "receipts", name: "Receipts", type: "user" },
      accounts: [
        {
          accountEmail: "expired@example.com",
          status: "failed",
          error: "invalid_grant",
        },
        { accountEmail: "has@example.com", status: "existing" },
        { accountEmail: "missing@example.com", status: "created" },
      ],
    });
    expect(mocks.gmailCreateLabel).toHaveBeenCalledTimes(1);
    expect(mocks.gmailCreateLabel).toHaveBeenCalledWith(
      "missing-token",
      "receipts",
    );
    expect(mocks.addCachedGmailLabel).toHaveBeenCalledWith(
      "owner@example.com",
      "missing@example.com",
      expect.objectContaining({ id: "Label_9", name: "receipts" }),
    );
    expect(mocks.addCachedGmailLabel).toHaveBeenCalledWith(
      "owner@example.com",
      "has@example.com",
      { id: "Label_7", name: "Receipts", type: "user" },
    );
  });

  it("reports a label Gmail saved as created when the label cache write fails", async () => {
    mocks.isConnected.mockResolvedValue(true);
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [{ email: "new@example.com", accessToken: "new-token" }],
      errors: [],
    });
    mocks.gmailListLabels.mockResolvedValue({ labels: [] });
    mocks.gmailCreateLabel.mockResolvedValue({
      id: "Label_3",
      name: "Harbor",
      type: "user",
    });
    mocks.addCachedGmailLabel.mockRejectedValue(new Error("db offline"));

    const result = await action.run({ name: "Harbor" });

    expect(result).toEqual({
      status: "complete",
      backend: "gmail",
      label: { id: "harbor", name: "Harbor", type: "user" },
      accounts: [
        {
          accountEmail: "new@example.com",
          status: "created",
          error:
            "Saved in Gmail, but Mail's label cache did not update: db offline",
        },
      ],
    });
  });

  it("adds a local label once without a connected Gmail account", async () => {
    mocks.isConnected.mockResolvedValue(false);
    let stored: Record<string, unknown> | null = null;
    mocks.mutateUserSetting.mockImplementation(async (_owner, _key, update) => {
      stored = await update(stored);
      return stored;
    });

    const first = await action.run({ name: "Receipts" });
    const second = await action.run({ name: "receipts" });

    expect(first).toMatchObject({
      backend: "local",
      label: { id: "receipts", name: "Receipts" },
    });
    expect(second.label).toEqual(first.label);
    expect(stored).toEqual({
      labels: [{ id: "receipts", name: "Receipts", type: "user" }],
    });
  });
});
