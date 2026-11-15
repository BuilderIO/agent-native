import { beforeEach, describe, expect, it, vi } from "vitest";

// A sibling of usage.spec.ts that stays inside Core (that spec loads a
// template), so the mutation job can run it against the shared-key fallback.
const mockResolveSecretDetailed = vi.fn();
const mockReadAppSecretMeta = vi.fn();

vi.mock("../server/credential-provider.js", () => ({
  resolveSecretDetailed: (...args: unknown[]) =>
    mockResolveSecretDetailed(...args),
  resolveSecret: async () => null,
  resolveHasCompleteBuilderConnection: async () => false,
}));

vi.mock("./storage.js", () => ({
  readAppSecretMeta: (...args: unknown[]) => mockReadAppSecretMeta(...args),
}));

vi.mock("../server/agent-discovery.js", () => ({
  loadWorkspaceAppsManifest: async () => null,
}));

vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: () => "org-qa",
}));

vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => ({
    app: { id: "slides" },
    agent: { preferBringYourOwnKey: false },
  }),
}));

vi.mock("../agent/engine/index.js", () => ({
  registerBuiltinEngines: () => {},
  listAgentEngines: () => [],
  getAgentEngineEntry: () => undefined,
  getConfiguredEngineNameForRequest: async () => undefined,
  detectEngineFromUserSecrets: async () => null,
  isAgentEnginePackageInstalled: () => true,
}));

vi.mock("../agent/app-model-defaults.js", () => ({
  getAgentAppModelDefaultForCurrentRequest: async () => null,
}));

vi.mock("../agent/default-agent-engine.js", () => ({
  readDefaultAgentEngineSetting: async () => null,
}));

import { previewSecretRemoval } from "./usage.js";

describe("the shared-key fallback of a removal preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSecretDetailed.mockResolvedValue({
      value: "fake-shared-value",
      lookupFailed: false,
      source: "org",
      scopeId: "org-qa",
    });
  });

  it("names the Vault when the shared key was created through it", async () => {
    mockReadAppSecretMeta.mockResolvedValue({
      description: null,
      createdBy: "admin@example.test",
    });

    const preview = await previewSecretRemoval({ key: "MY_VAULT_KEY" });

    expect(preview.fallback).toEqual({ status: "shared", source: "vault" });
    expect(mockReadAppSecretMeta).toHaveBeenCalledWith({
      key: "MY_VAULT_KEY",
      scope: "org",
      scopeId: "org-qa",
    });
  });

  it("names the Vault for a key a release before the move marked in its description", async () => {
    mockReadAppSecretMeta.mockResolvedValue({
      description: "Synced from Dispatch vault: Legacy key",
      createdBy: null,
    });

    const preview = await previewSecretRemoval({ key: "MY_VAULT_KEY" });

    expect(preview.fallback).toEqual({ status: "shared", source: "vault" });
  });

  it("names the organization for a key an app registered itself", async () => {
    mockReadAppSecretMeta.mockResolvedValue({
      description: "An app's own key",
      createdBy: null,
    });

    const preview = await previewSecretRemoval({ key: "MY_VAULT_KEY" });

    expect(preview.fallback).toEqual({ status: "shared", source: "org" });
  });

  it("names the workspace for an app-registered workspace key", async () => {
    mockResolveSecretDetailed.mockResolvedValue({
      value: "fake-shared-value",
      lookupFailed: false,
      source: "workspace",
      scopeId: "solo:admin@example.test",
    });
    mockReadAppSecretMeta.mockResolvedValue({
      description: null,
      createdBy: null,
    });

    const preview = await previewSecretRemoval({ key: "MY_VAULT_KEY" });

    expect(preview.fallback).toEqual({ status: "shared", source: "workspace" });
  });
});
