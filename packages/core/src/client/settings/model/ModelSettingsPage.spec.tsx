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
  chatgpt: undefined as unknown,
  modelsError: false,
  modelsRefetch: vi.fn(),
  lab: false,
  builder: {} as Record<string, unknown>,
  header: null as { action?: unknown } | null,
  loop: {
    maxIterations: 400,
    defaultMaxIterations: 400,
    minMaxIterations: 1,
    maxMaxIterations: 1000,
    scope: "org",
    source: "default",
    canUpdate: true,
    orgId: "org-1",
  },
}));
const callActionMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const dialogProps = vi.hoisted(() => ({ last: null as unknown }));
const loopMock = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("../../use-action.js", () => ({
  useActionQuery: (name: string) => ({
    data:
      name === "list-model-providers"
        ? state.listing
        : name === "get-provider-models"
          ? state.models
          : name === "get-chatgpt-subscription-status"
            ? state.chatgpt
            : undefined,
    isError: name === "get-provider-models" ? state.modelsError : false,
    refetch: name === "get-provider-models" ? state.modelsRefetch : vi.fn(),
  }),
  callAction: callActionMock,
}));

vi.mock("../../org/hooks.js", () => ({
  useOrg: () => ({ data: { orgName: "Acme" }, isLoading: false }),
}));

vi.mock("../../labs/use-lab.js", () => ({
  useLabState: () => ({
    enabled: state.lab,
    isLoading: false,
    isError: false,
    isSuccess: true,
  }),
}));

vi.mock("../useBuilderStatus.js", () => ({
  useBuilderConnectFlow: () => state.builder,
  isPopupClosed: () => false,
  POPUP_CLOSED_CONFIRMATION_GRACE_MS: 20_000,
}));

vi.mock("../deferred-builder-connect-popover.js", () => ({
  // The real popover asks whether to create an account, then calls onConnect.
  DeferredBuilderConnectPopover: ({
    children,
    onConnect,
  }: {
    children: React.ReactElement<{ onClick?: () => void }>;
    onConnect?: (provisionAccount: boolean) => void;
  }) => React.cloneElement(children, { onClick: () => onConnect?.(false) }),
}));

vi.mock("../shell/context.js", () => ({
  useSettingsShell: () => ({ navigate: navigateMock }),
  useSettingsPageHeader: (header: { action?: unknown } | null) => {
    state.header = header;
  },
}));

vi.mock("../../agent-loop-settings.js", () => ({
  fetchAgentLoopSettings: async () => state.loop,
  saveAgentLoopMaxIterations: loopMock.save,
}));

vi.mock("../../agent-engine-key.js", () => ({
  setAgentEngineDefaultModel: vi.fn(),
}));

vi.mock("./ProviderDialog.js", () => ({
  ProviderDialog: (props: { open: boolean }) => {
    dialogProps.last = props;
    return props.open ? <div data-testid="provider-dialog" /> : null;
  },
}));

vi.mock("./RemoveProviderDialog.js", () => ({
  RemoveProviderDialog: (props: { provider: string }) => (
    <div data-testid="remove-dialog">{props.provider}</div>
  ),
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
    formatList: (value: string[]) =>
      new Intl.ListFormat("en-US", { type: "conjunction" }).format(value),
  }),
}));

import ModelSettingsPage from "./ModelSettingsPage.js";

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
    canManageOrg: false,
    personalKeysRestricted: false,
    defaultModel: { engine: "ai-sdk:groq", model: "llama-3.3-70b" },
    defaultModelSource: "org",
    canUpdateDefault: false,
    ...overrides,
  };
}

function models(): ProviderModelsRead {
  return {
    providers: [
      ...PROVIDERS.map((provider) => ({
        provider,
        recommendedModels:
          provider === "groq"
            ? ["llama-3.3-70b", "llama-3.1-8b", "llama-3-8b"]
            : ["model-a", "model-b"],
        rows: { user: { models: null }, org: { models: null } },
      })),
      {
        provider: "builder",
        recommendedModels: ["auto", "gpt-5.6-luna"],
        rows: { user: { models: null }, org: { models: null } },
      },
    ],
  };
}

function builderFlow(overrides: Record<string, unknown> = {}) {
  return {
    hasFetchedStatus: true,
    configured: true,
    connecting: false,
    error: null,
    orgName: "Acme Space",
    effective: "org",
    grants: { org: { connectedAt: 1, needsReconnect: false } },
    canConnect: { org: false, personal: true },
    start: vi.fn(),
    ...overrides,
  };
}

function row(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No row ${id}`);
  return element;
}

function buttons(element: HTMLElement): string[] {
  return [...element.querySelectorAll("button")].map(
    (button) => button.textContent?.trim() ?? "",
  );
}

describe("ModelSettingsPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.listing = listing();
    state.models = models();
    state.modelsError = false;
    state.modelsRefetch = vi.fn();
    state.chatgpt = { connected: false, reconnectRequired: false };
    state.lab = false;
    state.builder = builderFlow();
    state.header = null;
    state.loop = { ...state.loop, canUpdate: true };
    callActionMock.mockReset();
    navigateMock.mockReset();
    loopMock.save.mockReset();
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

  async function render() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ModelSettingsPage
            pageId="model"
            sub={null}
            context={{} as never}
            bridge={{} as never}
          />
        </QueryClientProvider>,
      );
    });
  }

  it("shows members organization providers read-only and their own as manageable", async () => {
    state.listing = listing(
      {},
      {
        groq: { org: { scope: "org", updatedAt: 1 } },
        anthropic: {
          personal: { scope: "user", masked: "••••1234", updatedAt: 1 },
        },
      },
    );
    state.loop = { ...state.loop, canUpdate: false };
    await render();

    expect(container.textContent).toContain("Organization providers");
    expect(row("provider-org-builder").textContent).toContain(
      "Connected · Acme Space",
    );
    expect(buttons(row("provider-org-builder"))).toEqual(["View"]);
    expect(row("provider-org-groq").textContent).toContain("3 models");
    expect(row("provider-org-groq").textContent).not.toContain("••••");
    expect(buttons(row("provider-org-groq"))).toEqual([]);

    expect(row("provider-personal-builder").textContent).toContain(
      "Connect your own account to use it instead of the organization's.",
    );
    expect(buttons(row("provider-personal-builder"))).toEqual(["Connect"]);
    act(() => {
      (
        row("provider-personal-builder").querySelector("button") as HTMLElement
      ).click();
    });
    expect(state.builder.start).toHaveBeenCalledWith({
      provisionAccount: false,
      scope: "personal",
    });
    expect(row("provider-personal-anthropic").textContent).toContain(
      "••••1234 · 2 models",
    );
    expect(buttons(row("provider-personal-anthropic"))).toEqual(["Manage"]);

    expect(row("default-model").textContent).toContain("llama-3.3-70b · Groq");
    expect(row("default-model").querySelector('[role="combobox"]')).toBeNull();
    expect(row("max-iterations").querySelector("input")).toBeNull();
    await vi.waitFor(() => {
      expect(row("max-iterations").textContent).toContain("400");
    });
    expect(document.getElementById("restrict-personal-keys")).toBeNull();

    act(() => {
      (
        row("provider-org-builder").querySelector("button") as HTMLElement
      ).click();
    });
    expect(navigateMock).toHaveBeenCalledWith("integrations", "builder");
  });

  it("gives admins the organization key, the default select, and the restriction", async () => {
    state.listing = listing(
      { canManageOrg: true, canUpdateDefault: true },
      {
        groq: { org: { scope: "org", masked: "••••abcd", updatedAt: 1 } },
      },
    );
    state.builder = builderFlow({ canConnect: { org: true, personal: false } });
    callActionMock.mockImplementation(async (_name, args) =>
      (args as { set?: boolean }).set === undefined
        ? {
            restricted: false,
            canManage: true,
            updatedAt: null,
            updatedBy: null,
            affectedMembers: [
              {
                email: "camila@example.com",
                providers: [
                  { provider: "openai", label: "OpenAI", keys: ["x"] },
                  { provider: "groq", label: "Groq", keys: ["y"] },
                ],
                builder: false,
              },
            ],
          }
        : {
            restricted: true,
            canManage: true,
            updatedAt: 2,
            updatedBy: "admin@example.com",
          },
    );
    await render();

    expect(row("provider-org-groq").textContent).toContain(
      "••••abcd · 3 models",
    );
    expect(buttons(row("provider-org-groq"))).toEqual(["Manage"]);
    expect(buttons(row("provider-org-builder"))).toEqual(["Manage"]);
    expect(document.getElementById("provider-personal-builder")).toBeNull();
    expect(
      row("default-model").querySelector('[role="combobox"]'),
    ).not.toBeNull();

    const toggle = await vi.waitFor(() => {
      const found = row("restrict-personal-keys").querySelector(
        '[role="switch"]',
      );
      if (!found) throw new Error("no switch yet");
      return found as HTMLElement;
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      toggle.click();
    });
    expect(document.body.textContent).toContain("Restrict personal API keys?");
    expect(document.body.textContent).toContain("camila@example.com");
    expect(document.body.textContent).toContain(
      "Their OpenAI and Groq keys stop working.",
    );
    expect(callActionMock).not.toHaveBeenCalledWith(
      "manage-provider-key-policy",
      { set: true },
      expect.anything(),
    );

    const confirm = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Restrict keys",
    ) as HTMLElement;
    await act(async () => {
      confirm.click();
    });
    expect(callActionMock).toHaveBeenCalledWith(
      "manage-provider-key-policy",
      { set: true },
      { method: "POST" },
    );
  });

  it("shows a rejected key in red with Replace key", async () => {
    state.listing = listing(
      { canManageOrg: true },
      {
        openai: {
          org: {
            scope: "org",
            masked: "••••9f3a",
            updatedAt: 1,
            rejectedAt: Date.UTC(2026, 8, 24),
          },
        },
      },
    );
    await render();
    const rejected = row("provider-org-openai");
    expect(rejected.textContent).toContain(
      "OpenAI rejected this key on Sep 24. Chats that use it stop until you replace it.",
    );
    expect(rejected.querySelector(".text-destructive")).not.toBeNull();
    expect(buttons(rejected)).toEqual(["Replace key"]);
    await act(async () => {
      (rejected.querySelector("button") as HTMLElement).click();
    });
    expect(dialogProps.last).toMatchObject({
      open: true,
      mode: "manage",
      provider: "openai",
      scope: "org",
    });
  });

  it("marks a restricted member's personal keys unused with Remove", async () => {
    state.listing = listing(
      { personalKeysRestricted: true },
      {
        mistral: {
          personal: { scope: "user", masked: "••••7777", updatedAt: 1 },
        },
      },
    );
    state.builder = builderFlow({
      canConnect: { org: false, personal: false },
    });
    await render();
    const personal = row("provider-personal-mistral");
    expect(personal.textContent).toContain(
      "Not used while personal API keys are restricted.",
    );
    expect(buttons(personal)).toEqual(["Remove"]);
    expect(document.getElementById("provider-personal-builder")).toBeNull();
    expect(container.textContent).toContain(
      "Owners and admins restricted personal API keys.",
    );
    expect(state.header?.action).toBeUndefined();

    await act(async () => {
      (personal.querySelector("button") as HTMLElement).click();
    });
    expect(
      document.querySelector('[data-testid="remove-dialog"]')?.textContent,
    ).toBe("mistral");
  });

  it("shows the restriction as the empty state when nothing personal is left", async () => {
    state.listing = listing({ personalKeysRestricted: true });
    state.builder = builderFlow({
      canConnect: { org: false, personal: false },
    });
    await render();
    expect(
      document.getElementById("personal-providers")?.textContent,
    ).toContain("Owners and admins restricted personal API keys.");
  });

  it("shows placeholders for model counts and the default while models load", async () => {
    state.listing = listing(
      { canManageOrg: true, canUpdateDefault: true },
      { groq: { org: { scope: "org", masked: "••••abcd", updatedAt: 1 } } },
    );
    state.models = undefined;
    await render();
    const groq = row("provider-org-groq");
    expect(groq.textContent).toContain("••••abcd");
    expect(groq.querySelector("[data-model-count-loading]")).not.toBeNull();
    const defaultRow = row("default-model");
    expect(
      defaultRow.querySelector("[data-default-model-loading]"),
    ).not.toBeNull();
    expect(defaultRow.querySelector('[role="combobox"]')).toBeNull();
    expect(defaultRow.textContent).not.toContain("Not set");
  });

  it("says the default model couldn't load instead of offering nothing", async () => {
    state.listing = listing(
      { canManageOrg: true, canUpdateDefault: true },
      { groq: { org: { scope: "org", masked: "••••abcd", updatedAt: 1 } } },
    );
    state.models = undefined;
    state.modelsError = true;
    await render();
    const defaultRow = row("default-model");
    expect(defaultRow.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't load this setting.",
    );
    expect(defaultRow.querySelector('[role="combobox"]')).toBeNull();
    expect(defaultRow.textContent).not.toContain("llama-3.3-70b");
    expect(
      row("provider-org-groq").querySelector("[data-model-count-loading]"),
    ).toBeNull();
    await act(async () => {
      (
        [...defaultRow.querySelectorAll("button")].find(
          (button) => button.textContent === "Retry",
        ) as HTMLElement
      ).click();
    });
    expect(state.modelsRefetch).toHaveBeenCalled();
  });

  it("offers Add provider while something can be added", async () => {
    await render();
    expect(state.header?.action).toBeTruthy();
  });

  it("starts an owner with no provider at an empty state that adds one", async () => {
    state.listing = listing({
      canManageOrg: true,
      canUpdateDefault: true,
      defaultModel: null,
    });
    state.builder = builderFlow({
      configured: false,
      grants: { org: null, personal: null },
      canConnect: { org: true, personal: true },
    });
    await render();

    const empty = row("llm");
    expect(empty.textContent).toContain("Add a model provider");
    expect(empty.textContent).toContain(
      "The agent needs a provider to respond.",
    );
    expect(buttons(empty)).toEqual(["Add provider", "Connect Builder.io"]);
    expect(document.getElementById("provider-org-builder")).toBeNull();

    const defaultRow = row("default-model");
    expect(defaultRow.textContent).toContain(
      "Add a provider to choose a default model.",
    );
    expect(
      defaultRow.querySelector<HTMLButtonElement>('[role="combobox"]')
        ?.disabled,
    ).toBe(true);
    expect(defaultRow.textContent).not.toContain("Not set");

    await act(async () => {
      (
        [...empty.querySelectorAll("button")].find(
          (button) => button.textContent === "Add provider",
        ) as HTMLElement
      ).click();
    });
    expect(
      document.querySelector('[data-testid="provider-dialog"]'),
    ).not.toBeNull();
    act(() => {
      (
        [...empty.querySelectorAll("button")].find(
          (button) => button.textContent === "Connect Builder.io",
        ) as HTMLElement
      ).click();
    });
    expect(state.builder.start).toHaveBeenCalledWith({
      provisionAccount: false,
      scope: "org",
    });
  });

  it("tells a restricted member with no provider to ask an admin", async () => {
    state.listing = listing({ personalKeysRestricted: true });
    state.builder = builderFlow({
      configured: false,
      grants: { org: null, personal: null },
      canConnect: { org: false, personal: true },
    });
    await render();

    const empty = row("llm");
    expect(empty.textContent).toContain("Add a model provider");
    expect(empty.textContent).toContain("Ask an owner or admin to add one.");
    expect(buttons(empty)).toEqual([]);
    expect(document.getElementById("personal-providers")).toBeNull();
  });

  it("keeps the provider groups until the Builder.io status is known", async () => {
    state.listing = listing({ canManageOrg: true });
    state.builder = builderFlow({
      hasFetchedStatus: false,
      grants: null,
    });
    await render();

    expect(container.textContent).not.toContain("Add a model provider");
    expect(row("provider-org-builder")).toBeTruthy();
  });

  it("lists the ChatGPT subscription with a Labs badge while its lab is on", async () => {
    state.lab = true;
    await render();
    const chatgpt = row("chatgpt-subscription");
    expect(chatgpt.textContent).toContain("ChatGPT subscription");
    expect(chatgpt.textContent).toContain("Labs");
    expect(buttons(chatgpt)).toEqual(["Connect"]);
  });

  it("saves Max iterations for admins and refuses a value out of range", async () => {
    loopMock.save.mockResolvedValue({ ...state.loop, maxIterations: 250 });
    await render();
    const input = await vi.waitFor(() => {
      const found = row("max-iterations").querySelector("input");
      if (!found) throw new Error("no input yet");
      return found as HTMLInputElement;
    });
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;

    act(() => {
      setter.call(input, "5000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(row("max-iterations").textContent).toContain(
      "Enter a whole number from 1 to 1000.",
    );
    expect(loopMock.save).not.toHaveBeenCalled();

    act(() => {
      setter.call(input, "250");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(loopMock.save).toHaveBeenCalledWith(250);
  });
});
