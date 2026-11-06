import { beforeEach, describe, expect, it, vi } from "vitest";

import { getUserSetting } from "../settings/user-settings.js";
import { workspaceIntegrationMessagesForUser } from "./workspace-integration-messages.js";

vi.mock("../settings/user-settings.js", () => ({ getUserSetting: vi.fn() }));

describe("workspaceIntegrationMessagesForUser", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses the user's locale for integration errors", async () => {
    vi.mocked(getUserSetting).mockResolvedValue({ locale: "fr-FR" });
    const messages =
      await workspaceIntegrationMessagesForUser("user@example.test");
    expect(messages.referenceSignIn).toBe(
      "Connectez-vous pour rechercher des références de l’espace de travail.",
    );
    expect({
      authentication: messages.composerReferenceAuthentication,
      invalid: messages.composerReferenceInvalid,
      unavailable: messages.composerReferenceUnavailable,
    }).toEqual({
      authentication: "Connectez-vous pour ajouter une référence.",
      invalid: "Choisissez une référence valide avant l’envoi.",
      unavailable:
        "Une référence sélectionnée n’est plus disponible. Supprimez-la ou sélectionnez-la à nouveau.",
    });
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
    expect(
      (await workspaceIntegrationMessagesForUser("")).composerReferenceInvalid,
    ).toBe("Choose a valid reference before sending.");
    expect(
      (await workspaceIntegrationMessagesForUser("user@example.test"))
        .composerReferenceInvalid,
    ).toBe("Choose a valid reference before sending.");
    vi.mocked(getUserSetting).mockResolvedValue(undefined);
    expect(
      (await workspaceIntegrationMessagesForUser("user@example.test"))
        .composerReferenceAuthentication,
    ).toBe("Sign in to add a reference.");
    expect(getUserSetting).toHaveBeenCalledTimes(3);
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
