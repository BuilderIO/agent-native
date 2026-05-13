import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAppSecret: vi.fn(),
}));

vi.mock("@agent-native/core/secrets", () => ({
  writeAppSecret: mocks.writeAppSecret,
}));

import {
  credentialStoreScopeForVaultCtx,
  syncSecretsToCredentialStore,
} from "./vault-store.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("credentialStoreScopeForVaultCtx", () => {
  it("uses org scope when vault sync runs inside an org", () => {
    expect(
      credentialStoreScopeForVaultCtx({
        ownerEmail: "admin@example.test",
        orgId: "org_123",
      }),
    ).toEqual({ scope: "org", scopeId: "org_123" });
  });

  it("uses workspace solo scope when no org is active", () => {
    expect(
      credentialStoreScopeForVaultCtx({
        ownerEmail: "owner@example.test",
        orgId: null,
      }),
    ).toEqual({
      scope: "workspace",
      scopeId: "solo:owner@example.test",
    });
  });
});

describe("syncSecretsToCredentialStore", () => {
  it("writes vault secrets into app_secrets without returning values", async () => {
    const result = await syncSecretsToCredentialStore(
      [
        {
          name: "OpenAI API Key",
          credentialKey: "OPENAI_API_KEY",
          value: "sk-test-key",
        } as any,
      ],
      { ownerEmail: "admin@example.test", orgId: "org_123" },
    );

    expect(mocks.writeAppSecret).toHaveBeenCalledWith({
      key: "OPENAI_API_KEY",
      value: "sk-test-key",
      scope: "org",
      scopeId: "org_123",
      description: "Synced from Dispatch vault: OpenAI API Key",
    });
    expect(result).toEqual({
      scope: "org",
      scopeId: "org_123",
      keys: ["OPENAI_API_KEY"],
    });
  });
});
