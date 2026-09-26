// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import englishMessages from "../../../localization/core-messages/en-US.js";
import type {
  ModelProviderEntry,
  ModelProvidersListing,
  ProviderModelsRead,
} from "./model-page-state.js";

const state = vi.hoisted(() => ({
  listing: undefined as unknown,
  models: undefined as unknown,
  preview: undefined as unknown,
}));
const keyMock = vi.hoisted(() => ({
  fetchProviderModels: vi.fn(),
  saveAgentEngineProviderSettings: vi.fn(),
  deleteAgentEngineProviderSettings: vi.fn(),
}));
const callActionMock = vi.hoisted(() => vi.fn());

vi.mock("../../use-action.js", () => ({
  useActionQuery: (name: string) => ({
    data:
      name === "list-model-providers"
        ? state.listing
        : name === "get-provider-models"
          ? state.models
          : name === "preview-secret-removal"
            ? state.preview
            : undefined,
    isError: false,
    refetch: vi.fn(),
  }),
  callAction: callActionMock,
}));

vi.mock("../../agent-engine-key.js", () => keyMock);

vi.mock("../../org/hooks.js", () => ({
  useOrg: () => ({ data: { orgName: "Acme" }, isLoading: false }),
}));

vi.mock("../../i18n.js", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, unknown>): string => {
      const flat = englishMessages as Record<string, string>;
      const base = key.replace(/^agentChat\./, "");
      const count = options?.count;
      const template =
        (typeof count === "number"
          ? flat[`${base}_${count === 1 ? "one" : "other"}`]
          : undefined) ??
        flat[base] ??
        key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(options?.[name] ?? ""),
      );
    },
  useFormatters: () => ({
    formatDate: (value: number, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
        value,
      ),
  }),
}));

import { ProviderDialog, type ProviderDialogProps } from "./ProviderDialog.js";

const PROVIDERS = [
  "openrouter",
  "ollama",
  "anthropic",
  "openai",
  "google",
  "groq",
  "mistral",
  "cohere",
] as const;
const LABELS: Record<string, string> = {
  openrouter: "OpenRouter",
  ollama: "Ollama",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  groq: "Groq",
  mistral: "Mistral",
  cohere: "Cohere",
};

function listing(
  overrides: Partial<ModelProvidersListing> = {},
  entries: Partial<Record<string, Partial<ModelProviderEntry>>> = {},
): ModelProvidersListing {
  return {
    providers: PROVIDERS.map((provider) => ({
      provider,
      label: LABELS[provider],
      org: null,
      personal: null,
      ...entries[provider],
    })),
    hasOrganization: true,
    canManageOrg: true,
    personalKeysRestricted: false,
    defaultModel: null,
    defaultModelSource: "none",
    canUpdateDefault: true,
    ...overrides,
  };
}

function models(
  selections: Record<string, { user?: string[]; org?: string[] }> = {},
): ProviderModelsRead {
  return {
    providers: PROVIDERS.map((provider) => ({
      provider,
      recommendedModels:
        provider === "anthropic"
          ? ["claude-sonnet-5", "claude-haiku-4-5"]
          : provider === "groq"
            ? ["llama-3.3-70b"]
            : ["model-a"],
      rows: {
        user: { models: selections[provider]?.user ?? null },
        org: { models: selections[provider]?.org ?? null },
      },
    })),
  };
}

function inputByLabel(label: string): HTMLInputElement {
  const labelEl = [...document.querySelectorAll("label")].find(
    (el) => el.textContent === label,
  );
  if (!labelEl) throw new Error(`No label ${label}`);
  return document.getElementById(labelEl.htmlFor) as HTMLInputElement;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === text,
  );
  if (!found) throw new Error(`No button ${text}`);
  return found as HTMLButtonElement;
}

function checkbox(model: string): HTMLButtonElement {
  const label = [...document.querySelectorAll("label")].find(
    (el) => el.textContent === model,
  );
  if (!label) throw new Error(`No model ${model}`);
  return document.getElementById(label.htmlFor) as HTMLButtonElement;
}

describe("ProviderDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.listing = listing();
    state.models = models();
    state.preview = undefined;
    keyMock.fetchProviderModels.mockReset();
    keyMock.saveAgentEngineProviderSettings.mockReset().mockResolvedValue({});
    keyMock.deleteAgentEngineProviderSettings
      .mockReset()
      .mockResolvedValue(undefined);
    callActionMock.mockReset().mockResolvedValue({});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function render(props: Partial<ProviderDialogProps> = {}) {
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ProviderDialog
            open
            mode="add"
            onOpenChange={onOpenChange}
            onSaved={onSaved}
            {...props}
          />
        </QueryClientProvider>,
      );
    });
    return { onOpenChange, onSaved };
  }

  it("checks a pasted key and saves it with its models at the organization scope", async () => {
    keyMock.fetchProviderModels.mockResolvedValue({
      ok: true,
      provider: "anthropic",
      models: ["claude-sonnet-5", "claude-haiku-4-5", "claude-opus-4-8"],
      checkedAt: 1,
    });
    const { onSaved, onOpenChange } = render({ provider: "anthropic" });

    expect(document.body.textContent).toContain("Add provider");
    expect(document.body.textContent).toContain(
      "Personal providers are only yours. Organization providers work for everyone in Acme.",
    );
    expect(document.body.textContent).toContain(
      "Paste a key to see the models it can use.",
    );

    typeInto(inputByLabel("API key"), "sk-ant-test-0000");
    expect(document.body.textContent).toContain(
      "Checking your key with Anthropic",
    );
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("claude-opus-4-8");
    });
    expect(keyMock.fetchProviderModels).toHaveBeenCalledWith({
      provider: "anthropic",
      key: "sk-ant-test-0000",
    });
    expect(checkbox("claude-sonnet-5").getAttribute("data-state")).toBe(
      "checked",
    );
    expect(checkbox("claude-opus-4-8").getAttribute("data-state")).toBe(
      "unchecked",
    );

    await act(async () => {
      button("Add provider").click();
    });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(keyMock.saveAgentEngineProviderSettings).toHaveBeenCalledWith({
      provider: "anthropic",
      apiKey: "sk-ant-test-0000",
      scope: "org",
    });
    expect(callActionMock).toHaveBeenCalledWith("manage-provider-models", {
      action: "set",
      provider: "anthropic",
      scope: "org",
      models: ["claude-sonnet-5", "claude-haiku-4-5"],
    });
    expect(onSaved).toHaveBeenCalledWith({
      provider: "anthropic",
      scope: "org",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps Add disabled until the key checks out and keeps a failed save open", async () => {
    keyMock.fetchProviderModels.mockResolvedValue({
      ok: true,
      provider: "anthropic",
      models: ["claude-sonnet-5"],
      checkedAt: 1,
    });
    keyMock.saveAgentEngineProviderSettings.mockRejectedValue(
      new Error("Vault is unavailable."),
    );
    const { onOpenChange } = render({ provider: "anthropic" });

    expect(button("Add provider").disabled).toBe(true);
    expect(button("Add provider").type).toBe("submit");
    typeInto(inputByLabel("API key"), "sk-ant-test-0000");
    expect(button("Add provider").disabled).toBe(true);
    await vi.waitFor(() => {
      expect(button("Add provider").disabled).toBe(false);
    });

    await act(async () => {
      button("Add provider").click();
    });
    await vi.waitFor(() => {
      expect(
        document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
      ).toContain("Vault is unavailable.");
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("locks members to a personal key", async () => {
    state.listing = listing({ canManageOrg: false });
    keyMock.fetchProviderModels.mockResolvedValue({
      ok: true,
      provider: "groq",
      models: ["llama-3.3-70b"],
      checkedAt: 1,
    });
    const { onSaved } = render({ provider: "groq" });

    expect(document.body.textContent).toContain(
      "Only owners and admins can add organization providers.",
    );
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();

    typeInto(inputByLabel("API key"), "gsk_test_1111");
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("llama-3.3-70b");
    });
    await act(async () => {
      button("Add provider").click();
    });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(keyMock.saveAgentEngineProviderSettings).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "groq", scope: "user" }),
    );
  });

  it("says why a provider rejected the key and doesn't save it", async () => {
    keyMock.fetchProviderModels.mockResolvedValue({
      ok: false,
      provider: "anthropic",
      models: [],
      code: "rejected",
      reason: "Anthropic keys start with sk-ant-.",
      expectedPrefix: "sk-ant-",
      checkedAt: 1,
    });
    render({ provider: "anthropic" });

    typeInto(inputByLabel("API key"), "not-a-real-key-000");
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "Anthropic rejected this key",
      );
    });
    expect(document.body.textContent).toContain(
      "Anthropic keys start with sk-ant-.",
    );
    await act(async () => {
      button("Add provider").click();
    });
    expect(keyMock.saveAgentEngineProviderSettings).not.toHaveBeenCalled();
  });

  it("names the provider a key belongs to", async () => {
    keyMock.fetchProviderModels.mockResolvedValue({
      ok: false,
      provider: "openai",
      models: [],
      code: "wrong-provider",
      reason: "This looks like an Anthropic key.",
      detectedProvider: "anthropic",
      checkedAt: 1,
    });
    render({ provider: "openai" });
    typeInto(inputByLabel("API key"), "sk-ant-test-2222");
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "This looks like an Anthropic key.",
      );
    });
  });

  it("asks for an Ollama endpoint instead of a key", async () => {
    keyMock.fetchProviderModels.mockResolvedValue({
      ok: true,
      provider: "ollama",
      models: ["llama3.1:latest"],
      checkedAt: 1,
    });
    render({ provider: "ollama" });
    expect(document.body.textContent).toContain("No API key required.");
    typeInto(inputByLabel("Endpoint URL"), "http://ollama.internal:11434");
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("llama3.1:latest");
    });
    expect(keyMock.fetchProviderModels).toHaveBeenCalledWith({
      provider: "ollama",
      baseUrl: "http://ollama.internal:11434",
    });
  });

  it("manages a saved key: masked, checked on save, and models only", async () => {
    state.listing = listing(
      {},
      {
        openai: {
          org: {
            scope: "org",
            masked: "••••9f3a",
            updatedAt: Date.UTC(2026, 8, 24),
          },
        },
      },
    );
    state.models = models({ openai: { org: ["gpt-a", "gpt-b"] } });
    const { onSaved } = render({
      mode: "manage",
      provider: "openai",
      scope: "org",
    });

    expect(document.body.textContent).toContain("••••9f3a");
    expect(document.body.textContent).toContain("Checked Sep 24, 2026.");
    expect(button("Replace")).toBeTruthy();
    expect(button("Remove provider")).toBeTruthy();
    expect(document.body.textContent).toContain("Add an endpoint URL");
    expect(checkbox("gpt-a").getAttribute("data-state")).toBe("checked");

    act(() => {
      checkbox("gpt-b").click();
    });
    await act(async () => {
      button("Save").click();
    });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(keyMock.saveAgentEngineProviderSettings).not.toHaveBeenCalled();
    expect(callActionMock).toHaveBeenCalledWith("manage-provider-models", {
      action: "set",
      provider: "openai",
      scope: "org",
      models: ["gpt-a"],
    });
  });

  it("asks for a new key when the saved one was rejected", () => {
    state.listing = listing(
      {},
      {
        groq: {
          personal: {
            scope: "user",
            masked: "••••1111",
            updatedAt: 1,
            rejectedAt: 2,
          },
        },
      },
    );
    render({ mode: "manage", provider: "groq", scope: "user" });
    expect(inputByLabel("API key")).toBeTruthy();
    expect(document.body.textContent).toContain(
      "Groq rejected the saved key. Paste a new one.",
    );
  });

  it("adds a service's key for the organization with chat models unchecked", async () => {
    keyMock.fetchProviderModels.mockResolvedValue({
      ok: true,
      provider: "groq",
      models: ["llama-3.3-70b", "whisper-large-v3"],
      checkedAt: 1,
    });
    const { onSaved } = render({
      mode: "add-from-service",
      provider: "groq",
      serviceLabel: "voice input",
    });
    expect(document.body.textContent).toContain("Add Groq");
    expect(document.body.textContent).toContain(
      "Services use organization keys.",
    );
    expect(document.body.textContent).toContain(
      "Chat models are optional. Leave them unchecked to use this key only for voice input.",
    );
    typeInto(inputByLabel("API key"), "gsk_test_3333");
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("llama-3.3-70b");
    });
    expect(checkbox("llama-3.3-70b").getAttribute("data-state")).toBe(
      "unchecked",
    );
    await act(async () => {
      button("Add Groq").click();
    });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(keyMock.saveAgentEngineProviderSettings).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "groq", scope: "org" }),
    );
    expect(callActionMock).toHaveBeenCalledWith(
      "manage-provider-models",
      expect.objectContaining({ provider: "groq", models: [] }),
    );
  });

  it("lets a member replace their rejected personal key from Add, as chat recovery opens it", async () => {
    state.listing = listing(
      { canManageOrg: false },
      {
        anthropic: {
          personal: {
            scope: "user",
            masked: "••••1111",
            updatedAt: 1,
            rejectedAt: 2,
          },
        },
      },
    );
    state.models = models({ anthropic: { user: ["claude-haiku-4-5"] } });
    keyMock.fetchProviderModels.mockResolvedValue({
      ok: true,
      provider: "anthropic",
      models: ["claude-sonnet-5", "claude-haiku-4-5"],
      checkedAt: 1,
    });
    const { onSaved } = render({ provider: "anthropic" });

    expect(document.body.textContent).toContain(
      "Anthropic rejected the saved key. Paste a new one.",
    );
    expect(document.body.textContent).not.toContain(
      "Only owners and admins can add organization providers.",
    );
    typeInto(inputByLabel("API key"), "sk-ant-test-2222");
    await vi.waitFor(() => {
      expect(checkbox("claude-haiku-4-5").getAttribute("data-state")).toBe(
        "checked",
      );
    });
    expect(checkbox("claude-sonnet-5").getAttribute("data-state")).toBe(
      "unchecked",
    );
    await act(async () => {
      button("Replace key").click();
    });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(keyMock.saveAgentEngineProviderSettings).toHaveBeenCalledWith({
      provider: "anthropic",
      apiKey: "sk-ant-test-2222",
      scope: "user",
    });
  });

  it("replaces an admin's rejected organization key at the organization scope", async () => {
    state.listing = listing(
      {},
      {
        anthropic: {
          org: {
            scope: "org",
            masked: "••••3333",
            updatedAt: 1,
            rejectedAt: 2,
          },
        },
      },
    );
    keyMock.fetchProviderModels.mockResolvedValue({
      ok: true,
      provider: "anthropic",
      models: ["claude-sonnet-5"],
      checkedAt: 1,
    });
    const { onSaved } = render({ provider: "anthropic" });

    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect(document.body.textContent).toContain("Organization");
    typeInto(inputByLabel("API key"), "sk-ant-test-4444");
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("claude-sonnet-5");
    });
    await act(async () => {
      button("Replace key").click();
    });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(keyMock.saveAgentEngineProviderSettings).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic", scope: "org" }),
    );
  });

  it("offers a new provider first and names a replace when every provider has a key", () => {
    const saved = {
      scope: "user" as const,
      masked: "••••5555",
      updatedAt: 1,
    };
    state.listing = listing(
      { canManageOrg: false },
      Object.fromEntries(PROVIDERS.map((id) => [id, { personal: saved }])),
    );
    render();
    expect(button("Replace key")).toBeTruthy();
    expect(() => button("Add provider")).toThrow();
  });

  it("tells a restricted member they can't add personal keys", () => {
    state.listing = listing({
      canManageOrg: false,
      personalKeysRestricted: true,
    });
    render();
    expect(document.body.textContent).toContain(
      "Owners and admins restricted personal API keys.",
    );
    expect(document.querySelector("input")).toBeNull();
  });
});
