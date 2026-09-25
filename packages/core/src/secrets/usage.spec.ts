import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveSecretDetailed = vi.fn();
const mockResolveSecret = vi.fn();
const mockResolveHasCompleteBuilderConnection = vi.fn();
const mockReadAppSecretMeta = vi.fn();
const mockLoadWorkspaceAppsManifest = vi.fn();
const mockGetConfiguredEngineNameForRequest = vi.fn();
const mockDetectEngineFromUserSecrets = vi.fn();
const mockGetRequestOrgId = vi.fn();

const ENGINES = [
  {
    name: "builder",
    label: "Builder.io Gateway",
    requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
  },
  {
    name: "anthropic",
    label: "Claude",
    requiredEnvVars: ["ANTHROPIC_API_KEY"],
  },
  {
    name: "ai-sdk:openai",
    label: "OpenAI",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
];

vi.mock("../server/credential-provider.js", () => ({
  resolveSecretDetailed: (...args: any[]) => mockResolveSecretDetailed(...args),
  resolveSecret: (...args: any[]) => mockResolveSecret(...args),
  resolveHasCompleteBuilderConnection: () =>
    mockResolveHasCompleteBuilderConnection(),
}));

vi.mock("./storage.js", () => ({
  readAppSecretMeta: (...args: any[]) => mockReadAppSecretMeta(...args),
  VAULT_SYNC_DESCRIPTION_PREFIX: "Synced from Dispatch vault:",
}));

vi.mock("../server/agent-discovery.js", () => ({
  loadWorkspaceAppsManifest: (...args: any[]) =>
    mockLoadWorkspaceAppsManifest(...args),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: () => mockGetRequestOrgId(),
}));

vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => ({
    app: { id: "slides" },
    agent: { preferBringYourOwnKey: false },
  }),
}));

vi.mock("../agent/engine/index.js", () => ({
  registerBuiltinEngines: () => {},
  listAgentEngines: () => ENGINES,
  getAgentEngineEntry: (name: string) =>
    ENGINES.find((entry) => entry.name === name),
  getConfiguredEngineNameForRequest: (...args: any[]) =>
    mockGetConfiguredEngineNameForRequest(...args),
  detectEngineFromUserSecrets: () => mockDetectEngineFromUserSecrets(),
  isAgentEnginePackageInstalled: () => true,
}));

// Slides imports the public entry; point it at this source tree so the
// template's real registrations land in the registry under test.
vi.mock("@agent-native/core/secrets", async () => import("./register.js"));

import { registerFrameworkSecrets } from "./register-framework-secrets.js";
import { __resetSecretsRegistry, registerRequiredSecret } from "./register.js";
import { describeSecretUsage, previewSecretRemoval } from "./usage.js";

async function registerSlides() {
  vi.resetModules();
  await import("../../../../templates/slides/server/register-secrets.ts");
  registerFrameworkSecrets();
}

describe("secret usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSecretsRegistry();
    mockGetRequestOrgId.mockReturnValue("org-qa");
    mockResolveSecretDetailed.mockResolvedValue({
      value: null,
      lookupFailed: false,
    });
    mockResolveSecret.mockResolvedValue(null);
    mockResolveHasCompleteBuilderConnection.mockResolvedValue(false);
    mockReadAppSecretMeta.mockResolvedValue(null);
    mockLoadWorkspaceAppsManifest.mockResolvedValue(null);
    mockGetConfiguredEngineNameForRequest.mockResolvedValue(undefined);
    mockDetectEngineFromUserSecrets.mockResolvedValue(null);
  });

  it("keeps framework uses when a template registers the same key", async () => {
    await registerSlides();

    expect(describeSecretUsage("OPENAI_API_KEY")).toEqual([
      {
        feature: "Agent",
        effectWhenRemoved: "OpenAI models leave the model picker.",
      },
      expect.objectContaining({ appId: "slides", feature: "Image generation" }),
      expect.objectContaining({ feature: "Realtime voice" }),
      expect.objectContaining({ feature: "Voice input" }),
    ]);
  });

  it("previews OPENAI_API_KEY removal in Slides: image generation and the agent's models", async () => {
    await registerSlides();
    mockDetectEngineFromUserSecrets.mockResolvedValue(ENGINES[2]);
    mockResolveHasCompleteBuilderConnection.mockResolvedValue(true);
    mockLoadWorkspaceAppsManifest.mockResolvedValue([
      { id: "slides", name: "Slides" },
      { id: "clips", name: "Clips" },
    ]);

    const preview = await previewSecretRemoval({ key: "OPENAI_API_KEY" });

    expect(preview).toMatchObject({
      key: "OPENAI_API_KEY",
      registered: true,
      scope: "user",
      affects: "only-you",
      fallback: { status: "none" },
      otherApps: { status: "listed", apps: [{ id: "clips", name: "Clips" }] },
    });
    expect(preview.managedBy).toBeUndefined();
    expect(
      preview.effects.map(({ app, feature, effect }) => [app, feature, effect]),
    ).toEqual([
      ["all", "Agent", "OpenAI models leave the model picker."],
      ["all", "Agent", "The default model switches to Builder.io."],
      [
        "slides",
        "Image generation",
        "Uses another image provider, or stops if none is set up.",
      ],
      [
        "all",
        "Realtime voice",
        "Uses Builder.io when it's connected, otherwise stops.",
      ],
      [
        "all",
        "Voice input",
        "Uses another voice provider, or stops if none is set up.",
      ],
    ]);
    expect(preview.effects[0]).toMatchObject({
      code: "models-leave-picker",
      params: { provider: "OpenAI" },
    });
    expect(preview.effects[0].models?.length).toBeGreaterThan(0);
  });

  it("says chats stop when no other provider can take over the default", async () => {
    registerRequiredSecret({
      key: "ANTHROPIC_API_KEY",
      label: "Anthropic API key",
      scope: "user",
      kind: "api-key",
    });
    mockGetConfiguredEngineNameForRequest.mockResolvedValue("anthropic");

    const preview = await previewSecretRemoval({
      key: "ANTHROPIC_API_KEY",
      appId: "slides",
    });

    expect(mockGetConfiguredEngineNameForRequest).toHaveBeenCalledWith({
      appId: "slides",
    });
    expect(preview.effects).toEqual([
      expect.objectContaining({
        effect: "Anthropic models leave the model picker.",
      }),
      {
        app: "all",
        feature: "Agent",
        effect: "Chats stop until another provider is set up.",
        code: "default-model-stops",
      },
    ]);
  });

  it("switches the default to another provider whose key still resolves", async () => {
    mockGetConfiguredEngineNameForRequest.mockResolvedValue("anthropic");
    mockResolveSecret.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY" ? "fake-openai" : null,
    );

    const preview = await previewSecretRemoval({ key: "ANTHROPIC_API_KEY" });

    expect(preview.effects[1]).toMatchObject({
      effect: "The default model switches to OpenAI.",
      code: "default-model-switches",
      params: { next: "OpenAI" },
    });
  });

  it("reports that a shared key takes over a removed personal key", async () => {
    await registerSlides();
    mockResolveSecretDetailed.mockResolvedValue({
      value: "fake-org-value",
      lookupFailed: false,
      source: "org",
      scopeId: "org-qa",
    });
    mockReadAppSecretMeta.mockResolvedValue({
      description: "Synced from Dispatch vault: OpenAI",
    });

    const preview = await previewSecretRemoval({ key: "OPENAI_API_KEY" });

    expect(mockResolveSecretDetailed).toHaveBeenCalledWith("OPENAI_API_KEY", {
      skipUserScope: true,
    });
    expect(preview.fallback).toEqual({ status: "shared", source: "vault" });
    expect(new Set(preview.effects.map((effect) => effect.effect))).toEqual(
      new Set(["Keeps working with the Vault key."]),
    );
    expect(mockDetectEngineFromUserSecrets).not.toHaveBeenCalled();
  });

  it("reports an unreadable credential store instead of no fallback", async () => {
    mockResolveSecretDetailed.mockResolvedValue({
      value: null,
      lookupFailed: true,
    });

    const preview = await previewSecretRemoval({ key: "MY_WEBHOOK" });

    expect(preview.fallback).toEqual({
      status: "unknown",
      error: "Could not read the credential store",
    });
  });

  it("marks org-scoped removal as affecting the organization and skips the personal fallback", async () => {
    const preview = await previewSecretRemoval({
      key: "OPENAI_API_KEY",
      scope: "org",
    });

    expect(preview.affects).toBe("organization");
    expect(preview.fallback).toEqual({ status: "none" });
    expect(mockResolveSecretDetailed).not.toHaveBeenCalled();
  });

  it("names the owner of a managed key", async () => {
    const preview = await previewSecretRemoval({ key: "S3_SECRET_ACCESS_KEY" });

    expect(preview.managedBy).toEqual({
      id: "storage",
      owner: "File uploads and storage",
      route: "infrastructure",
    });
    expect(preview.effects).toEqual([
      expect.objectContaining({ feature: "File uploads and storage" }),
    ]);
  });

  it("reports an unreadable workspace manifest as unavailable", async () => {
    mockLoadWorkspaceAppsManifest.mockRejectedValue(
      new Error("Invalid workspace apps environment manifest"),
    );

    const preview = await previewSecretRemoval({ key: "MY_WEBHOOK" });

    expect(preview.otherApps).toEqual({
      status: "unavailable",
      error: "Invalid workspace apps environment manifest",
    });
    expect(mockLoadWorkspaceAppsManifest).toHaveBeenCalledWith(true);
  });

  it("runs as the preview-secret-removal action for signed-in callers", async () => {
    const { default: action } =
      await import("./actions/preview-secret-removal.js");

    await expect(
      action.run({ key: "OPENAI_API_KEY" }, { caller: "tool" }),
    ).rejects.toThrow("Not authenticated.");

    const preview = await action.run(
      { key: "MY_WEBHOOK", scope: "workspace" },
      { caller: "tool", userEmail: "alice+qa@example.com", appId: "slides" },
    );
    expect(preview).toMatchObject({
      key: "MY_WEBHOOK",
      scope: "workspace",
      affects: "organization",
      registered: false,
      effects: [],
    });
  });
});
