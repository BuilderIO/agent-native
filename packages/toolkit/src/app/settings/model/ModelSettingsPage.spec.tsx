// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import englishMessages from "../../i18n/catalogs/en-US.js";
import type {
  ModelProviderEntry,
  ModelProvidersListing,
  ProviderModelsRead,
} from "./model-page-state.js";

const state = vi.hoisted(() => ({
  listing: undefined as unknown,
  models: undefined as unknown,
  chatgpt: undefined as unknown,
  chatgptLabEnabled: true,
  chatgptStatusError: false,
  chatgptStatusRefetch: vi.fn(),
  modelsError: false,
  modelsRefetch: vi.fn(),
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
const popupMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const dialogProps = vi.hoisted(() => ({ last: null as unknown }));
const loopMock = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  useActionQuery: (name: string) => ({
    data:
      name === "list-model-providers"
        ? state.listing
        : name === "get-provider-models"
          ? state.models
          : name === "get-chatgpt-subscription-status"
            ? state.chatgpt
            : undefined,
    isError:
      name === "get-provider-models"
        ? state.modelsError
        : name === "get-chatgpt-subscription-status"
          ? state.chatgptStatusError
          : false,
    refetch:
      name === "get-provider-models"
        ? state.modelsRefetch
        : name === "get-chatgpt-subscription-status"
          ? state.chatgptStatusRefetch
          : vi.fn(),
  }),
  callAction: callActionMock,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgName: "Acme" }, isLoading: false }),
}));

vi.mock("@agent-native/core/client/labs/use-lab", () => ({
  useLabState: () => ({ enabled: state.chatgptLabEnabled }),
}));

vi.mock("../useBuilderStatus.js", () => ({
  useBuilderConnectFlow: () => state.builder,
  isPopupClosed: (popup: { closed?: boolean } | null) => popup?.closed === true,
}));

vi.mock("@agent-native/core/client/oauth-popup", () => ({
  openOAuthPopup: popupMock,
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

vi.mock("@agent-native/core/client/agent-loop-settings", () => ({
  fetchAgentLoopSettings: async () => state.loop,
  saveAgentLoopMaxIterations: loopMock.save,
}));

vi.mock("@agent-native/core/client/agent-engine-key", () => ({
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

vi.mock("@agent-native/core/client/i18n", () => ({
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

/** Each button's label and whether it is the primary or an outline one. */
function prominence(element: HTMLElement): string[] {
  return [...element.querySelectorAll("button")].map((button) => {
    const kind = button.classList.contains("bg-primary")
      ? "primary"
      : button.classList.contains("border")
        ? "outline"
        : "other";
    return `${button.textContent?.trim() ?? ""}:${kind}`;
  });
}

const ACCOUNT = {
  id: "siwc_test-account",
  email: "person@example.test",
  label: "person@example.test",
  connected: true,
  reconnectRequired: false,
  planUsageEnabled: true,
  active: true,
};

function connectedChatGPT(accounts: Array<typeof ACCOUNT> = [ACCOUNT]) {
  return {
    supported: true,
    supportReason: null,
    connected: true,
    reconnectRequired: false,
    activeAccountId: accounts[0]!.id,
    activeAccount: accounts[0],
    accounts,
    legacyRegistrationCleanupAvailable: false,
  };
}

function pointerDown(element: Element | null | undefined) {
  if (!element) throw new Error("Nothing to open");
  element.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerType: "mouse",
    }),
  );
}

function chatgptMenuTrigger(): HTMLElement {
  return row("chatgpt-subscription").querySelector(
    'button[aria-label="Manage"]',
  ) as HTMLElement;
}

function listed(selector: string): string[] {
  return [...document.body.querySelectorAll(selector)].map(
    (element) => element.textContent?.trim() ?? "",
  );
}

describe("ModelSettingsPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.listing = listing();
    state.models = models();
    state.modelsError = false;
    state.modelsRefetch = vi.fn();
    state.chatgptStatusError = false;
    state.chatgptStatusRefetch = vi.fn();
    state.chatgptLabEnabled = true;
    state.chatgpt = {
      supported: true,
      supportReason: null,
      connected: false,
      reconnectRequired: false,
      activeAccountId: null,
      activeAccount: null,
      accounts: [],
    };
    state.builder = builderFlow();
    state.header = null;
    queryClient = new QueryClient();
    state.loop = { ...state.loop, canUpdate: true };
    callActionMock.mockReset();
    callActionMock.mockResolvedValue({ engines: [] });
    popupMock.mockReset();
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
        <QueryClientProvider client={queryClient}>
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

  it("starts an owner with no provider at an empty state led by Builder.io", async () => {
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
      "The agent needs a provider to respond. We recommend Builder.io for model access, browser automation, file storage, and workspace identity. Free tier available.",
    );
    expect(prominence(empty)).toEqual([
      "Connect Builder.io:primary",
      "Add provider:outline",
    ]);
    // The empty state holds the page's one primary, so the header is empty.
    expect(state.header?.action).toBeUndefined();
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
    expect(row("personal-providers")).toBeTruthy();
    expect(buttons(row("chatgpt-subscription"))).toEqual([
      "Continue with ChatGPT",
    ]);
  });

  it("makes Add provider the empty state's primary when Builder.io can't be connected", async () => {
    state.builder = builderFlow({
      configured: false,
      grants: { org: null, personal: null },
      canConnect: { org: false, personal: false },
    });
    await render();

    const empty = row("llm");
    expect(empty.textContent).toContain(
      "The agent needs a provider to respond.",
    );
    expect(empty.textContent).not.toContain("We recommend Builder.io");
    expect(prominence(empty)).toEqual(["Add provider:primary"]);
    expect(state.header?.action).toBeUndefined();
  });

  it("returns the header to Add provider once a provider is set up, and recommends Builder.io on its row", async () => {
    state.listing = listing(
      { canManageOrg: true, canUpdateDefault: true },
      {
        anthropic: { org: { scope: "org", masked: "••••1234", updatedAt: 1 } },
      },
    );
    state.builder = builderFlow({
      configured: false,
      grants: { org: null, personal: null },
      canConnect: { org: true, personal: true },
    });
    await render();

    expect(document.querySelector("[data-model-settings] #llm")).toBeTruthy();
    expect(container.textContent).not.toContain("Add a model provider");
    const action = state.header?.action as React.ReactElement | undefined;
    expect((action?.type as { name?: string } | undefined)?.name).toBe(
      "AddProviderButton",
    );
    const builderRow = row("provider-org-builder");
    expect(builderRow.textContent).toContain("Recommended");
    expect(prominence(builderRow)).toEqual(["Connect:outline"]);
  });

  it("doesn't recommend a member's own Builder.io over the organization's connection", async () => {
    state.builder = builderFlow({
      grants: {
        org: { connectedAt: 1, needsReconnect: false },
        personal: null,
      },
      canConnect: { org: false, personal: true },
    });
    await render();

    expect(row("provider-personal-builder").textContent).not.toContain(
      "Recommended",
    );
    expect(row("provider-org-builder").textContent).not.toContain(
      "Recommended",
    );
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

  it("shows official local ChatGPT plan access when its Lab is enabled", async () => {
    await render();
    const chatgpt = row("chatgpt-subscription");
    expect(chatgpt.textContent).toContain("ChatGPT plan access");
    expect(chatgpt.textContent).not.toContain("Labs");
    expect(buttons(chatgpt)).toEqual(["Continue with ChatGPT"]);
  });

  it("hides ChatGPT and its models while the Lab is off", async () => {
    state.listing = listing({ canManageOrg: true, canUpdateDefault: true });
    state.chatgpt = connectedChatGPT();
    state.chatgptLabEnabled = false;
    await render();

    expect(document.getElementById("chatgpt-subscription")).toBeNull();
    expect(callActionMock).not.toHaveBeenCalledWith("manage-agent-engine", {
      action: "list",
    });
  });

  it("keeps a connected ChatGPT plan personal when choosing the organization default", async () => {
    state.listing = listing(
      {
        canManageOrg: true,
        canUpdateDefault: true,
        defaultModel: null,
      },
      {
        anthropic: {
          org: { scope: "org", masked: "••••1234", updatedAt: 1 },
        },
      },
    );
    state.builder = builderFlow({
      configured: false,
      grants: { org: null, personal: null },
      canConnect: { org: true, personal: true },
    });
    state.chatgpt = connectedChatGPT();
    callActionMock.mockImplementation(async (name: string) =>
      name === "manage-agent-engine"
        ? {
            engines: [
              {
                name: "chatgpt-subscription",
                label: "ChatGPT plan access",
                supportedModels: ["gpt-5.5", "gpt-5.4"],
                modelDisplayNames: { "gpt-5.5": "GPT-5.5" },
              },
            ],
          }
        : {},
    );
    await render();

    expect(container.textContent).not.toContain("Add a model provider");
    expect(state.header?.action).toBeTruthy();
    expect(
      row("personal-providers").contains(row("chatgpt-subscription")),
    ).toBe(true);
    expect(row("chatgpt-subscription").textContent).toContain(
      "ChatGPT plan access",
    );
    const defaultRow = row("default-model");
    expect(defaultRow.textContent).not.toContain(
      "Add a provider to choose a default model.",
    );
    const select = await vi.waitFor(() => {
      const found =
        defaultRow.querySelector<HTMLButtonElement>('[role="combobox"]');
      if (!found) throw new Error("no select yet");
      return found;
    });
    expect(select.disabled).toBe(false);
    await act(async () => pointerDown(select));
    expect(listed('[role="option"]')).toEqual([
      "model-a · Anthropic",
      "model-b · Anthropic",
    ]);
    expect(
      listed('[role="option"]').some((option) => option.includes("ChatGPT")),
    ).toBe(false);
    expect(defaultRow.querySelector("[data-default-model-loading]")).toBeNull();
    expect(callActionMock).not.toHaveBeenCalledWith("manage-agent-engine", {
      action: "list",
    });
  });

  it("keeps ChatGPT status errors scoped to its personal row for org defaults", async () => {
    state.listing = listing({ canManageOrg: true, canUpdateDefault: true });
    state.chatgpt = undefined;
    state.chatgptStatusError = true;
    await render();

    const defaultRow = row("default-model");
    expect(defaultRow.querySelector('[role="combobox"]')).not.toBeNull();
    expect(defaultRow.querySelector('[role="alert"]')).toBeNull();
    expect(
      row("chatgpt-subscription").querySelector('[role="alert"]')?.textContent,
    ).toContain("Couldn't load this setting.");
    expect(callActionMock).not.toHaveBeenCalledWith("manage-agent-engine", {
      action: "list",
    });
  });

  it("says the ChatGPT models couldn't load instead of leaving the default empty", async () => {
    state.listing = listing({
      hasOrganization: false,
      canUpdateDefault: true,
      defaultModel: null,
    });
    state.builder = builderFlow({
      configured: false,
      grants: { org: null, personal: null },
      canConnect: { org: true, personal: true },
    });
    state.chatgpt = connectedChatGPT();
    callActionMock.mockImplementation(async (name: string) => {
      if (name === "manage-agent-engine") {
        return {
          engines: [
            {
              name: "chatgpt-subscription",
              supportedModels: [],
              configuredError: "OpenAI ChatGPT model listing failed",
            },
          ],
        };
      }
      return {};
    });
    await render();

    const defaultRow = row("default-model");
    await vi.waitFor(() => {
      expect(defaultRow.querySelector('[role="alert"]')?.textContent).toContain(
        "Couldn't load this setting.",
      );
    });
    expect(defaultRow.querySelector('[role="combobox"]')).not.toBeNull();
  });

  it("keeps ChatGPT status unknown when its read fails", async () => {
    state.listing = listing({ hasOrganization: false });
    state.builder = builderFlow({
      configured: false,
      grants: null,
      canConnect: { org: false, personal: false },
    });
    state.chatgpt = undefined;
    state.chatgptStatusError = true;
    await render();

    expect(container.textContent).not.toContain("Add a model provider");
    expect(
      row("default-model").querySelector('[role="alert"]')?.textContent,
    ).toContain("Couldn't load this setting.");
    expect(callActionMock).not.toHaveBeenCalledWith("manage-agent-engine", {
      action: "list",
    });
  });

  it("loads a fresh ChatGPT catalog after switching accounts", async () => {
    state.listing = listing({
      hasOrganization: false,
      canUpdateDefault: true,
      defaultModel: null,
    });
    state.builder = builderFlow({
      configured: false,
      grants: { org: null, personal: null },
      canConnect: { org: true, personal: true },
    });
    const second = {
      ...ACCOUNT,
      id: "siwc_second",
      label: "second@example.test",
    };
    let activeAccountId = ACCOUNT.id;
    state.chatgpt = connectedChatGPT([ACCOUNT, second]);
    callActionMock.mockImplementation(async (name: string) =>
      name === "manage-agent-engine"
        ? {
            engines: [
              {
                name: "chatgpt-subscription",
                supportedModels:
                  activeAccountId === ACCOUNT.id ? ["gpt-5.5"] : ["gpt-5.4"],
              },
            ],
          }
        : {},
    );

    await render();
    const defaultRow = row("default-model");
    const select = await vi.waitFor(() => {
      const found =
        defaultRow.querySelector<HTMLButtonElement>('[role="combobox"]');
      if (!found) throw new Error("No default model selector yet");
      return found;
    });
    await act(async () => pointerDown(select));
    await vi.waitFor(() => {
      expect(listed('[role="option"]')).toContain("gpt-5.5 · ChatGPT");
    });
    await act(async () => {
      select.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    const firstAccountFetches = callActionMock.mock.calls.filter(
      ([name]) => name === "manage-agent-engine",
    ).length;

    activeAccountId = second.id;
    state.chatgpt = {
      ...connectedChatGPT([ACCOUNT, second]),
      activeAccountId: second.id,
      activeAccount: second,
    };
    await render();
    const updatedSelect = await vi.waitFor(() => {
      const found =
        row("default-model").querySelector<HTMLButtonElement>(
          '[role="combobox"]',
        );
      if (!found) throw new Error("No default model selector after switch");
      return found;
    });
    await act(async () => pointerDown(updatedSelect));
    await vi.waitFor(() => {
      expect(
        callActionMock.mock.calls.filter(
          ([name]) => name === "manage-agent-engine",
        ).length,
      ).toBeGreaterThan(firstAccountFetches);
      expect(listed('[role="option"]')).toContain("gpt-5.4 · ChatGPT");
    });
    expect(listed('[role="option"]')).not.toContain("gpt-5.5 · ChatGPT");
  });

  it("doesn't flash the empty state before the ChatGPT status answers", async () => {
    state.builder = builderFlow({
      configured: false,
      grants: { org: null, personal: null },
      canConnect: { org: false, personal: false },
    });
    state.chatgpt = undefined;
    await render();
    expect(container.textContent).not.toContain("Add a model provider");
  });

  it("shows only Continue with ChatGPT when signed out, even with saved accounts", async () => {
    const saved = { ...ACCOUNT, connected: false, active: false };
    state.chatgpt = {
      ...connectedChatGPT([saved, { ...saved, id: "siwc_other" }]),
      connected: false,
      activeAccountId: null,
      activeAccount: null,
    };
    await render();
    const chatgpt = row("chatgpt-subscription");
    expect(buttons(chatgpt)).toEqual(["Continue with ChatGPT"]);
    expect(chatgpt.querySelector('[role="combobox"]')).toBeNull();
  });

  it("acknowledges Continue with ChatGPT at once and recovers if the window is closed", async () => {
    vi.useFakeTimers();
    try {
      const popup = { closed: false };
      popupMock.mockReturnValue(popup);
      await render();
      const chatgpt = row("chatgpt-subscription");
      await act(async () => {
        (chatgpt.querySelector("button") as HTMLElement).click();
      });
      const pending = chatgpt.querySelector("button") as HTMLButtonElement;
      expect(pending.textContent).toContain("Connecting…");
      expect(pending.disabled).toBe(true);

      popup.closed = true;
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      expect(buttons(chatgpt)).toEqual(["Continue with ChatGPT"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when the browser blocked the ChatGPT sign-in window", async () => {
    popupMock.mockReturnValue(null);
    await render();
    const chatgpt = row("chatgpt-subscription");
    await act(async () => {
      (chatgpt.querySelector("button") as HTMLElement).click();
    });
    expect(chatgpt.querySelector('[role="alert"]')?.textContent).toBe(
      "Allow pop-ups for this site, then try again.",
    );
    expect(buttons(chatgpt)).toEqual(["Continue with ChatGPT"]);
  });

  it("shows a connected account's email with one menu for the rest", async () => {
    state.chatgpt = connectedChatGPT();
    await render();
    const chatgpt = row("chatgpt-subscription");
    expect(chatgpt.textContent).toContain("person@example.test");
    expect(buttons(chatgpt)).toEqual([""]);
    expect(chatgpt.querySelector('[role="combobox"]')).toBeNull();

    await act(async () => pointerDown(chatgptMenuTrigger()));
    expect(listed('[role="menuitem"]')).toEqual([
      "Add another account",
      "Disconnect",
    ]);
  });

  it("switches between connected accounts only", async () => {
    const second = {
      ...ACCOUNT,
      id: "siwc_second",
      label: "second@example.test",
    };
    const signedOut = {
      ...ACCOUNT,
      id: "siwc_old",
      label: "old@example.test",
      connected: false,
    };
    state.chatgpt = connectedChatGPT([ACCOUNT, second, signedOut]);
    callActionMock.mockResolvedValue({});
    await render();
    const chatgpt = row("chatgpt-subscription");
    await act(async () =>
      pointerDown(chatgpt.querySelector('[role="combobox"]')),
    );
    expect(listed('[role="option"]')).toEqual([
      "person@example.test",
      "second@example.test",
    ]);
    await act(async () => {
      (
        [...document.body.querySelectorAll('[role="option"]')].find(
          (option) => option.textContent === "second@example.test",
        ) as HTMLElement
      ).click();
    });
    expect(callActionMock).toHaveBeenCalledWith(
      "select-chatgpt-subscription-account",
      { accountId: "siwc_second" },
    );
  });

  it("confirms before disconnecting and says where to revoke access afterwards", async () => {
    state.chatgpt = connectedChatGPT();
    callActionMock.mockResolvedValue({ remoteRevocationConfirmed: false });
    await render();

    await act(async () => pointerDown(chatgptMenuTrigger()));
    await act(async () => {
      (
        [...document.body.querySelectorAll('[role="menuitem"]')].find(
          (item) => item.textContent === "Disconnect",
        ) as HTMLElement
      ).click();
    });
    const dialog = document.body.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Disconnect ChatGPT?");
    expect(dialog?.textContent).toContain(
      "person@example.test will be signed out of this app and the agent will stop using your ChatGPT plan.",
    );
    expect(callActionMock).not.toHaveBeenCalledWith(
      "disconnect-chatgpt-subscription",
      expect.anything(),
    );

    await act(async () => {
      (
        [...(dialog?.querySelectorAll("button") ?? [])].find(
          (button) => button.textContent === "Disconnect",
        ) as HTMLElement
      ).click();
    });
    expect(callActionMock).toHaveBeenCalledWith(
      "disconnect-chatgpt-subscription",
      { accountId: ACCOUNT.id },
    );
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();

    const chatgpt = row("chatgpt-subscription");
    expect(chatgpt.textContent).toContain(
      "Disconnected here. Access may remain active in ChatGPT.",
    );
    const manageAccess = chatgpt.querySelector(
      'a[href="https://chatgpt.com/settings/usage"]',
    ) as HTMLAnchorElement;
    expect(manageAccess.textContent).toBe("Manage in ChatGPT");
  });

  it("leaves the account connected when the disconnect is cancelled", async () => {
    state.chatgpt = connectedChatGPT();
    await render();

    await act(async () => pointerDown(chatgptMenuTrigger()));
    await act(async () => {
      (
        [...document.body.querySelectorAll('[role="menuitem"]')].find(
          (item) => item.textContent === "Disconnect",
        ) as HTMLElement
      ).click();
    });
    await act(async () => {
      (
        [
          ...(document.body
            .querySelector('[role="alertdialog"]')
            ?.querySelectorAll("button") ?? []),
        ].find((button) => button.textContent === "Cancel") as HTMLElement
      ).click();
    });
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(callActionMock).not.toHaveBeenCalledWith(
      "disconnect-chatgpt-subscription",
      expect.anything(),
    );
  });

  it("shows why a disconnect failed instead of closing silently", async () => {
    state.chatgpt = connectedChatGPT();
    callActionMock.mockRejectedValue(
      new Error("ChatGPT account was not found."),
    );
    await render();

    await act(async () => pointerDown(chatgptMenuTrigger()));
    await act(async () => {
      (
        [...document.body.querySelectorAll('[role="menuitem"]')].find(
          (item) => item.textContent === "Disconnect",
        ) as HTMLElement
      ).click();
    });
    await act(async () => {
      (
        [
          ...(document.body
            .querySelector('[role="alertdialog"]')
            ?.querySelectorAll("button") ?? []),
        ].find((button) => button.textContent === "Disconnect") as HTMLElement
      ).click();
    });
    expect(
      row("chatgpt-subscription").querySelector('[role="alert"]')?.textContent,
    ).toBe("ChatGPT account was not found.");
  });

  it("offers explicit removal of an unusable legacy ChatGPT sign-in", async () => {
    state.chatgpt = {
      supported: true,
      supportReason: null,
      connected: false,
      reconnectRequired: false,
      activeAccountId: null,
      activeAccount: null,
      accounts: [],
      legacyRegistrationCleanupAvailable: true,
    };
    callActionMock.mockResolvedValue({
      removed: true,
      remoteRevocationConfirmed: false,
    });
    await render();

    const chatgpt = row("chatgpt-subscription");
    expect(chatgpt.textContent).toContain(
      "An older ChatGPT sign-in is saved here. The official flow cannot use it.",
    );
    await act(async () => {
      const remove = [...chatgpt.querySelectorAll("button")].find(
        (button) => button.textContent === "Remove old sign-in",
      ) as HTMLElement;
      remove.click();
    });

    expect(callActionMock).toHaveBeenCalledWith(
      "disconnect-chatgpt-subscription",
      { removeLegacyCredential: true },
    );
    expect(chatgpt.textContent).toContain(
      "Disconnected here. Access may remain active in ChatGPT.",
    );
  });

  it("explains hosted ChatGPT approval needs without a request link", async () => {
    state.chatgpt = {
      supported: false,
      supportReason: "requires_local_loopback",
      connected: false,
      reconnectRequired: false,
      activeAccountId: null,
      activeAccount: null,
      accounts: [],
    };
    await render();
    const chatgpt = row("chatgpt-subscription");
    expect(chatgpt.textContent).toContain(
      "Open-source apps are self-serve when run locally with a loopback callback; no partner application is needed. Hosted apps on *.agent-native.com need operator approval and a hosted callback.",
    );
    expect(chatgpt.querySelector("a")).toBeNull();
    expect(buttons(chatgpt)).toEqual([]);
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
