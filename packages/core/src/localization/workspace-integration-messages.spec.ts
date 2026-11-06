import { beforeEach, describe, expect, it, vi } from "vitest";

import { getUserSetting } from "../settings/user-settings.js";
import { workspaceIntegrationMessagesForUser } from "./workspace-integration-messages.js";

vi.mock("../settings/user-settings.js", () => ({ getUserSetting: vi.fn() }));

describe("workspaceIntegrationMessagesForUser", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses the user's locale for integration errors", async () => {
    vi.mocked(getUserSetting).mockResolvedValue({ locale: "fr-FR" });
    expect(
      (await workspaceIntegrationMessagesForUser("user@example.test"))
        .referenceSignIn,
    ).toBe(
      "Connectez-vous pour rechercher des références de l’espace de travail.",
    );
  });

  it("falls back to English for missing or unsupported preferences", async () => {
    vi.mocked(getUserSetting).mockResolvedValue({ locale: "unknown" });
    expect(
      (await workspaceIntegrationMessagesForUser("user@example.test"))
        .referenceSignIn,
    ).toBe("Sign in to search workspace references.");
    expect(
      (await workspaceIntegrationMessagesForUser("")).referenceSignIn,
    ).toBe("Sign in to search workspace references.");
    expect(getUserSetting).toHaveBeenCalledTimes(1);
  });

  it("propagates a settings read failure", async () => {
    vi.mocked(getUserSetting).mockRejectedValue(
      new Error("settings unavailable"),
    );
    await expect(
      workspaceIntegrationMessagesForUser("user@example.test"),
    ).rejects.toThrow("settings unavailable");
  });
});
