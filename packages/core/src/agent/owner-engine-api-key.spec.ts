import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppSecretMock = vi.hoisted(() => vi.fn());
const getSettingMock = vi.hoisted(() => vi.fn());
const readDeployCredentialEnvMock = vi.hoisted(() => vi.fn());
const canUseDeployCredentialFallbackForRequestMock = vi.hoisted(() => vi.fn());

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: readAppSecretMock,
}));

vi.mock("../settings/store.js", () => ({
  getSetting: getSettingMock,
}));

vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: () => undefined,
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("../server/credential-provider.js", () => ({
  canUseDeployCredentialFallbackForRequest:
    canUseDeployCredentialFallbackForRequestMock,
  getProviderCredentialAuthFailure: vi.fn(async () => null),
  readDeployCredentialEnv: readDeployCredentialEnvMock,
}));

import { resolveOwnerEngineApiKey } from "./production-agent.js";

/** Owner-scoped `app_secrets` rows, keyed by the provider env var. */
function ownerSecrets(secrets: Record<string, string>) {
  readAppSecretMock.mockImplementation(async ({ key }: { key: string }) =>
    secrets[key] ? { value: secrets[key], last4: "-key", updatedAt: 1 } : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ownerSecrets({});
  getSettingMock.mockResolvedValue(undefined);
  readDeployCredentialEnvMock.mockReturnValue(undefined);
  canUseDeployCredentialFallbackForRequestMock.mockReturnValue(true);
});

describe("resolveOwnerEngineApiKey", () => {
  it("resolves the named engine's own key rather than the active setting's", async () => {
    // The regression this guards: the saved `agent-engine` setting decides
    // which provider `getOwnerActiveApiKey` reads, so a plugin configured for
    // OpenAI used to receive the owner's Anthropic key — untagged, which meant
    // `resolveEngine` handed a live Anthropic secret to OpenAI.
    getSettingMock.mockResolvedValue({ engine: "anthropic" });
    ownerSecrets({
      ANTHROPIC_API_KEY: "sk-ant-owner",
      OPENAI_API_KEY: "sk-openai-owner",
    });

    await expect(
      resolveOwnerEngineApiKey({
        engineOption: "ai-sdk:openai",
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toEqual({
      apiKey: "sk-openai-owner",
      apiKeyEnvVar: "OPENAI_API_KEY",
    });
  });

  it("never returns another provider's key for an engine the owner has no key for", async () => {
    getSettingMock.mockResolvedValue({ engine: "anthropic" });
    ownerSecrets({ ANTHROPIC_API_KEY: "sk-ant-owner" });

    await expect(
      resolveOwnerEngineApiKey({
        engineOption: "ai-sdk:openai",
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toEqual({ apiKey: undefined, apiKeyEnvVar: undefined });
  });

  it("reads the name out of an engine config object, not just a string", async () => {
    ownerSecrets({ OPENAI_API_KEY: "sk-openai-owner" });

    await expect(
      resolveOwnerEngineApiKey({
        engineOption: { name: "ai-sdk:openai", config: {} },
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toEqual({
      apiKey: "sk-openai-owner",
      apiKeyEnvVar: "OPENAI_API_KEY",
    });
  });

  it("falls back to the active engine's key, untagged, when no engine is named", async () => {
    // No explicit engine means the registry picks one and re-derives the
    // credential itself, so an opaque key is the honest answer here.
    getSettingMock.mockResolvedValue({ engine: "anthropic" });
    ownerSecrets({ ANTHROPIC_API_KEY: "sk-ant-owner" });

    await expect(
      resolveOwnerEngineApiKey({ ownerEmail: "owner@example.com" }),
    ).resolves.toEqual({ apiKey: "sk-ant-owner", apiKeyEnvVar: undefined });
  });

  it("pairs an explicit OpenAI engine with the OpenAI deploy key", async () => {
    readDeployCredentialEnvMock.mockImplementation((key: string) =>
      key === "OPENAI_API_KEY" ? "sk-openai-deploy" : undefined,
    );

    await expect(
      resolveOwnerEngineApiKey({
        engineOption: "openai",
        ownerEmail: "owner@example.com",
        anthropicFallback: "sk-ant-plugin-key",
      }),
    ).resolves.toEqual({
      apiKey: "sk-openai-deploy",
      apiKeyEnvVar: "OPENAI_API_KEY",
    });
  });

  it("tags the host fallback so a non-Anthropic engine cannot receive it", async () => {
    await expect(
      resolveOwnerEngineApiKey({
        engineOption: "openai",
        ownerEmail: "owner@example.com",
        anthropicFallback: "sk-ant-plugin-key",
      }),
    ).resolves.toEqual({
      apiKey: "sk-ant-plugin-key",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
    });
  });

  it("prefers a scoped owner key over the host fallback", async () => {
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(false);
    ownerSecrets({ ANTHROPIC_API_KEY: "scoped-owner-key" });

    await expect(
      resolveOwnerEngineApiKey({
        engineOption: "anthropic",
        ownerEmail: "owner@example.com",
        anthropicFallback: "plugin-api-key",
      }),
    ).resolves.toEqual({
      apiKey: "scoped-owner-key",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
    });
  });

  it("does not use deploy-level fallback keys for guarded runs", async () => {
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(false);
    readDeployCredentialEnvMock.mockReturnValue("deploy-provider-key");

    await expect(
      resolveOwnerEngineApiKey({
        engineOption: "anthropic",
        ownerEmail: "owner@example.com",
        anthropicFallback: "plugin-api-key",
      }),
    ).resolves.toEqual({ apiKey: undefined, apiKeyEnvVar: undefined });
    expect(readDeployCredentialEnvMock).not.toHaveBeenCalled();
  });
});
