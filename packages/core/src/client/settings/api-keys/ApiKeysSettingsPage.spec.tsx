// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import englishMessages from "../../../localization/core-messages/en-US.js";
import type { ApiKeyEntry, ApiKeysListing } from "./api-keys-state.js";

const state = vi.hoisted(() => ({
  listing: undefined as unknown,
  preview: undefined as unknown,
  header: null as { action?: React.ReactNode } | null,
  providerDialog: null as unknown,
}));
const callActionMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const clientMock = vi.hoisted(() => ({
  save: vi.fn(),
  test: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("../../use-action.js", () => ({
  useActionQuery: (name: string) => ({
    data:
      name === "list-api-keys"
        ? state.listing
        : name === "preview-secret-removal"
          ? state.preview
          : undefined,
    isError: false,
    refetch: vi.fn(),
  }),
  callAction: callActionMock,
}));

vi.mock("../../org/hooks.js", () => ({
  useOrg: () => ({ data: { orgName: "Acme" }, isLoading: false }),
}));

vi.mock("../shell/context.js", () => ({
  useSettingsShell: () => ({ navigate: navigateMock }),
  useSettingsPageHeader: (header: { action?: React.ReactNode } | null) => {
    state.header = header;
  },
}));

vi.mock("../model/ProviderDialog.js", () => ({
  ProviderDialog: (props: { open: boolean }) => {
    state.providerDialog = props;
    return props.open ? <div data-testid="provider-dialog" /> : null;
  },
}));

vi.mock("./api-keys-client.js", () => ({
  saveApiKeyValue: clientMock.save,
  testSavedApiKey: clientMock.test,
  notifyKeysChanged: clientMock.notify,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
    formatList: (value: string[]) =>
      new Intl.ListFormat("en-US", { type: "conjunction" }).format(value),
  }),
}));

import { DeleteKeyDialog, ServiceKeyDialog } from "./ApiKeyDialogs.js";
import ApiKeysSettingsPage from "./ApiKeysSettingsPage.js";

function entry(overrides: Partial<ApiKeyEntry>): ApiKeyEntry {
  return {
    name: "STRIPE_SECRET_KEY",
    scope: "user",
    storedScope: "user",
    masked: "••••5678",
    updatedAt: 1,
    registered: false,
    usedFor: [],
    canReplace: true,
    canDelete: true,
    canTest: false,
    ...overrides,
  };
}

const ANTHROPIC = entry({
  name: "ANTHROPIC_API_KEY",
  label: "Anthropic API key",
  masked: "••••1234",
  registered: true,
  provider: "anthropic",
  usedFor: [
    {
      feature: "Agent",
      effectWhenRemoved: "Anthropic models leave the model picker.",
    },
  ],
  canReplace: false,
});

const BUILDER = entry({
  name: "BUILDER_PRIVATE_KEY",
  scope: "org",
  storedScope: "org",
  masked: undefined,
  managedBy: {
    id: "builder",
    owner: "Builder.io",
    route: "integrations/builder",
  },
  canReplace: false,
  canDelete: false,
});

const CALENDAR = entry({
  name: "clips-calendar:google:1:refresh",
  masked: undefined,
  managedBy: { id: "meetings", owner: "Meetings", route: "app/meetings" },
  canReplace: false,
  canDelete: false,
});

function listing(overrides: Partial<ApiKeysListing> = {}): ApiKeysListing {
  return {
    keys: [ANTHROPIC, entry({})],
    managed: [BUILDER, CALENDAR],
    addable: [
      {
        name: "GITHUB_TOKEN",
        label: "GitHub token",
        scope: "user",
        docsUrl: "https://example.com/docs",
      },
    ],
    hasOrganization: true,
    canManageOrg: false,
    ...overrides,
  };
}

function row(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No row ${id}`);
  return element;
}

function buttonByText(text: string, scope: ParentNode = document) {
  const button = [...scope.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!button) throw new Error(`No button "${text}"`);
  return button;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ApiKeysSettingsPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.listing = listing();
    state.preview = undefined;
    state.header = null;
    state.providerDialog = null;
    callActionMock.mockReset();
    navigateMock.mockReset();
    clientMock.save.mockReset();
    clientMock.test.mockReset();
    window.history.replaceState(null, "", "/settings/api-keys");
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

  async function render(labs: Record<string, boolean> = {}) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ApiKeysSettingsPage
            pageId="api-keys"
            sub={null}
            context={{ labs } as never}
            bridge={{} as never}
          />
        </QueryClientProvider>,
      );
    });
  }

  async function renderHeader() {
    const header = document.createElement("div");
    document.body.appendChild(header);
    const headerRoot = createRoot(header);
    await act(async () => {
      headerRoot.render(
        <QueryClientProvider client={new QueryClient()}>
          {state.header?.action}
        </QueryClientProvider>,
      );
    });
    return header;
  }

  it("shows a member's own keys with what uses them, and managed keys collapsed", async () => {
    await render();

    const anthropic = row("secrets:ANTHROPIC_API_KEY");
    expect(anthropic.textContent).toContain("Anthropic API key");
    expect(anthropic.textContent).toContain("••••1234 · Used by Model");
    expect(buttonByText("Manage", anthropic)).toBeTruthy();

    const stripe = row("secrets:STRIPE_SECRET_KEY");
    expect(stripe.textContent).toContain("STRIPE_SECRET_KEY");
    expect(
      stripe.querySelector('[aria-label="Manage STRIPE_SECRET_KEY"]'),
    ).not.toBeNull();

    expect(container.textContent).toContain(
      "To use your own model provider, add it in Model.",
    );
    expect(container.textContent).not.toContain("Organization keys");

    // Calendar tokens stay hidden while Meetings is off.
    const managed = row("managed-keys");
    expect(managed.textContent).toContain("Managed by integrations");
    expect(managed.textContent).not.toContain("BUILDER_PRIVATE_KEY");
    await act(async () => buttonByText("Show 1 key", managed).click());
    expect(managed.textContent).toContain("BUILDER_PRIVATE_KEY");
    expect(managed.textContent).toContain("Used by Builder.io");
    expect(managed.textContent).toContain("Acme");
    // Read-only: no menu, no delete.
    expect(managed.querySelector('[aria-label^="Manage "]')).toBeNull();
    const link = managed.querySelector("a")!;
    expect(link.textContent).toBe("Builder.io");
    await act(async () => link.click());
    expect(navigateMock).toHaveBeenCalledWith("integrations", "builder");
  });

  it("shows calendar tokens only when Meetings is on", async () => {
    await render({ "clips.meetings": true });
    const managed = row("managed-keys");
    await act(async () => buttonByText("Show 2 keys", managed).click());
    expect(managed.textContent).toContain("clips-calendar:google:1:refresh");
    expect(managed.textContent).toContain("Used by Meetings");
  });

  it("opens the provider dialog from a provider key's Manage", async () => {
    await render();
    await act(async () =>
      buttonByText("Manage", row("secrets:ANTHROPIC_API_KEY")).click(),
    );
    expect(state.providerDialog).toMatchObject({
      open: true,
      mode: "manage",
      provider: "anthropic",
      scope: "user",
    });
  });

  it("lists organization keys for admins", async () => {
    state.listing = listing({
      canManageOrg: true,
      keys: [
        entry({}),
        entry({
          name: "OPENAI_API_KEY",
          label: "OpenAI API key",
          scope: "org",
          storedScope: "org",
          provider: "openai",
          canReplace: false,
        }),
      ],
    });
    await render();
    const org = row("org-keys");
    expect(org.textContent).toContain("Organization keys");
    await act(async () =>
      buttonByText("Manage", row("secrets:org-org:OPENAI_API_KEY")).click(),
    );
    expect(state.providerDialog).toMatchObject({
      provider: "openai",
      scope: "org",
    });
  });

  it("adds a key as a member, locked to Just me", async () => {
    clientMock.save.mockResolvedValue(undefined);
    await render();
    const header = await renderHeader();
    await act(async () => buttonByText("Add key", header).click());

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Just me");
    expect(dialog.textContent).toContain(
      "Only owners and admins can share keys with Acme.",
    );
    expect(dialog.querySelector('[role="combobox"]')).toBeNull();

    const [name, value] = [
      ...dialog.querySelectorAll("input"),
    ] as HTMLInputElement[];
    await act(async () => typeInto(name!, "linear key"));
    expect(name!.value).toBe("LINEAR_KEY");
    await act(async () => typeInto(value!, "fake-linear-value"));
    await act(async () => {
      dialog
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(clientMock.save).toHaveBeenCalledWith({
      name: "LINEAR_KEY",
      value: "fake-linear-value",
      registered: false,
      shared: false,
    });
  });

  it("sends model provider keys to Model and offers registered keys by name", async () => {
    await render();
    const header = await renderHeader();
    await act(async () => buttonByText("Add key", header).click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const [name] = [...dialog.querySelectorAll("input")] as HTMLInputElement[];

    await act(async () => typeInto(name!, "OPENAI_API_KEY"));
    expect(dialog.textContent).toContain("Add OpenAI in Model.");
    expect(buttonByText("Add key", dialog).disabled).toBe(true);

    await act(async () => typeInto(name!, "git"));
    await act(async () => buttonByText("GITHUB_TOKEN", dialog).click());
    expect(name!.value).toBe("GITHUB_TOKEN");
    expect(dialog.textContent).toContain("GitHub token");
    expect(dialog.textContent).toContain("Get key");
  });

  it("opens Add key for a #secrets:KEY link to a key nobody saved", async () => {
    window.history.replaceState(
      null,
      "",
      "/settings/api-keys#secrets:GOOGLE_APPLICATION_CREDENTIALS",
    );
    await render();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const [name] = [...dialog.querySelectorAll("input")] as HTMLInputElement[];
    expect(name!.value).toBe("GOOGLE_APPLICATION_CREDENTIALS");
  });

  it("opens the provider dialog for a #secrets:KEY link to a model provider's key", async () => {
    window.history.replaceState(
      null,
      "",
      "/settings/api-keys#secrets:GROQ_API_KEY",
    );
    await render();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(state.providerDialog).toMatchObject({
      open: true,
      mode: "add",
      provider: "groq",
      providers: ["groq"],
    });
  });

  it("opens nothing for a #secrets:KEY link to a provider key already saved", async () => {
    window.history.replaceState(
      null,
      "",
      "/settings/api-keys#secrets:ANTHROPIC_API_KEY",
    );
    await render();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(state.providerDialog).toMatchObject({ open: false });
  });
  it("starts Your keys from an empty state whose action is Add key", async () => {
    state.listing = listing({ keys: [], managed: [] });
    await render();
    const empty = container.querySelector("[data-api-keys-empty]");
    expect(empty?.textContent).toContain("No keys yet");
    expect(empty?.textContent).toContain(
      "Add a key so your apps and the agent can reach a service.",
    );
    await act(async () => buttonByText("Add key", empty!).click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Add key",
    );
  });

  it("keeps Add key open with the server's reason when the save fails", async () => {
    clientMock.save.mockRejectedValue(new Error("That value is too short."));
    await render();
    const header = await renderHeader();
    await act(async () => buttonByText("Add key", header).click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const [name, value] = [
      ...dialog.querySelectorAll("input"),
    ] as HTMLInputElement[];
    await act(async () => typeInto(name!, "LINEAR_KEY"));
    await act(async () => typeInto(value!, "x"));
    await act(async () => {
      dialog
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(
      "That value is too short.",
    );
  });

  it("marks a name another page owns as invalid", async () => {
    await render();
    const header = await renderHeader();
    await act(async () => buttonByText("Add key", header).click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const [name] = [...dialog.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => typeInto(name!, "OPENAI_API_KEY"));
    expect(name!.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(name!.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Add OpenAI in Model.");
  });
});

describe("DeleteKeyDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    callActionMock.mockReset();
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

  it("lists what stops before deleting the Anthropic key", async () => {
    state.preview = {
      key: "ANTHROPIC_API_KEY",
      registered: true,
      scope: "user",
      affects: "only-you",
      fallback: { status: "none" },
      effects: [
        {
          app: "all",
          feature: "Agent",
          effect: "Anthropic models leave the model picker.",
          code: "models-leave-picker",
          params: { provider: "Anthropic" },
        },
      ],
      otherApps: { status: "standalone" },
    };
    callActionMock.mockResolvedValue({
      ok: true,
      removed: ["ANTHROPIC_API_KEY"],
    });
    const onOpenChange = vi.fn();
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <DeleteKeyDialog
            open
            onOpenChange={onOpenChange}
            entry={ANTHROPIC}
            orgName="Acme"
          />
        </QueryClientProvider>,
      );
    });

    const dialog = document.querySelector(
      '[role="alertdialog"]',
    ) as HTMLElement;
    expect(dialog.textContent).toContain("Delete ANTHROPIC_API_KEY?");
    expect(dialog.textContent).toContain("This affects only you.");
    expect(dialog.textContent).toContain("Agent All apps");
    expect(dialog.textContent).toContain(
      "Anthropic models leave the model picker",
    );

    await act(async () => buttonByText("Delete key", dialog).click());
    expect(callActionMock).toHaveBeenCalledWith("delete-api-key", {
      name: "ANTHROPIC_API_KEY",
      scope: "user",
      storedScope: "user",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("adds a service's key for the organization in place", async () => {
    state.listing = listing({ canManageOrg: true });
    clientMock.save.mockResolvedValue(undefined);
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ServiceKeyDialog
            open
            onOpenChange={onOpenChange}
            keyName="VOYAGE_API_KEY"
            mode="add"
            onSaved={onSaved}
          />
        </QueryClientProvider>,
      );
    });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const [name, value] = [
      ...dialog.querySelectorAll("input"),
    ] as HTMLInputElement[];
    expect(name!.value).toBe("VOYAGE_API_KEY");
    expect(name!.readOnly).toBe(true);
    expect(dialog.textContent).toContain("Everyone in Acme");
    expect(dialog.querySelector('[role="combobox"]')).toBeNull();

    await act(async () => typeInto(value!, "fake-voyage-value"));
    await act(async () => {
      dialog
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(clientMock.save).toHaveBeenCalledWith({
      name: "VOYAGE_API_KEY",
      value: "fake-voyage-value",
      registered: false,
      shared: true,
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("replaces a service's saved organization key from Manage", async () => {
    state.listing = listing({
      canManageOrg: true,
      keys: [
        entry({
          name: "VOYAGE_API_KEY",
          scope: "org",
          storedScope: "org",
        }),
      ],
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ServiceKeyDialog
            open
            onOpenChange={vi.fn()}
            keyName="VOYAGE_API_KEY"
            mode="manage"
          />
        </QueryClientProvider>,
      );
    });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Replace VOYAGE_API_KEY");
    expect(dialog.querySelectorAll("input")).toHaveLength(1);
  });
});
