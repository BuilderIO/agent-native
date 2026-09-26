// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ServiceProviderServiceStatus,
  ServiceProvidersStatus,
} from "../../../agent/actions/manage-service-providers.js";
import type { FileStorageStatus } from "../../../file-upload/storage-settings.js";
import englishMessages from "../../../localization/core-messages/en-US.js";
import type { InfrastructureStatus } from "../../../server/infrastructure-status.js";
import type { ModelProvidersListing } from "../model/model-page-state.js";

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  errors: new Set<string>(),
  builder: {} as Record<string, unknown>,
}));
const callActionMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const providerDialog = vi.hoisted(() => ({ last: null as any }));
const serviceKeyDialog = vi.hoisted(() => ({ last: null as any }));
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);

vi.mock("../../use-action.js", () => ({
  useActionQuery: (name: string) => ({
    data: state.errors.has(name) ? undefined : state.queries[name],
    isError: state.errors.has(name),
    refetch: vi.fn(),
  }),
  callAction: callActionMock,
}));

vi.mock("../useBuilderStatus.js", () => ({
  useBuilderConnectFlow: () => state.builder,
}));

vi.mock("../deferred-builder-connect-popover.js", () => ({
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
}));

vi.mock("../model/ProviderDialog.js", () => ({
  ProviderDialog: (props: { open: boolean }) => {
    providerDialog.last = props;
    return props.open ? <div data-testid="provider-dialog" /> : null;
  },
}));

vi.mock("../api-keys/ApiKeyDialogs.js", () => ({
  ServiceKeyDialog: (props: { open: boolean }) => {
    serviceKeyDialog.last = props;
    return props.open ? <div data-testid="service-key-dialog" /> : null;
  },
}));

vi.mock("../StorageSettingsForm.js", () => ({
  StorageSettingsForm: () => <div data-testid="storage-form" />,
  fileStorageProviderPreset: (id: string) => ({
    name: id === "cloudflare-r2" ? "Cloudflare R2" : null,
    icon: () => null,
  }),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("../../i18n.js", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, unknown>): string => {
      const flat = englishMessages as Record<string, string>;
      const template = flat[key.replace(/^agentChat\./, "")] ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(options?.[name] ?? ""),
      );
    },
  useFormatters: () => ({
    formatList: (value: string[]) =>
      new Intl.ListFormat("en-US", { type: "conjunction" }).format(value),
  }),
}));

import { InfrastructureSettingsPage } from "./InfrastructureSettingsPage.js";

function infraStatus(
  overrides: Partial<InfrastructureStatus> = {},
): InfrastructureStatus {
  return {
    workspace: true,
    database: {
      configured: true,
      local: false,
      provider: "neon",
      host: "ep-quiet-sun-a1b2c3.us-east-2.aws.neon.tech",
      sourceKey: "DATABASE_URL",
      appDatabaseKey: "CLIPS_DATABASE_URL",
    },
    hosting: {
      platform: "netlify",
      environment: "production",
      gatewayUrl: "https://apps.example.com",
      apps: [
        { id: "dispatch", name: "Dispatch", url: null, path: "/dispatch" },
        {
          id: "clips",
          name: "Clips",
          url: "https://clips.example.com",
          path: "/clips",
        },
      ],
    },
    variables: [
      { key: "DATABASE_URL", required: true, set: true },
      { key: "A2A_SECRET", required: true, set: true },
      { key: "BETTER_AUTH_SECRET", required: false, set: false },
      { key: "APP_URL", required: false, set: false },
      { key: "SECRETS_ENCRYPTION_KEY", required: false, set: false },
    ],
    setupTags: {
      model: "required",
      storage: "required",
      voice: "recommended",
      images: null,
      embeddings: "recommended",
    },
    ...overrides,
  };
}

function service(
  id: ServiceProviderServiceStatus["service"],
  keys: Record<
    string,
    ServiceProviderServiceStatus["options"][number]["keyState"]
  >,
  effective: ServiceProviderServiceStatus["effectiveProvider"] = null,
): ServiceProviderServiceStatus {
  const providers = {
    voice: ["builder", "gemini", "groq", "openai"],
    images: ["builder", "gemini", "openai"],
    embeddings: ["builder", "gemini", "cohere", "voyage"],
  }[id] as ServiceProviderServiceStatus["options"][number]["provider"][];
  return {
    service: id,
    provider: null,
    effectiveProvider: effective,
    options: providers.map((provider) => ({
      provider,
      keyState: keys[provider] ?? "none",
    })),
  };
}

function servicesStatus(
  services: ServiceProviderServiceStatus[] = [
    service("voice", { gemini: "org" }),
    service("images", {}),
    service("embeddings", {}),
  ],
): ServiceProvidersStatus {
  return { canManage: true, updatedAt: null, updatedBy: null, services };
}

const STORAGE: FileStorageStatus = {
  canManage: true,
  configured: true,
  provider: "cloudflare-r2",
  endpoint: "https://example.r2.cloudflarestorage.com",
  bucket: "clips-recordings",
  region: null,
  publicBaseUrl: null,
  saved: {
    endpoint: true,
    bucket: true,
    accessKeyId: true,
    secretAccessKey: true,
    region: false,
    publicBaseUrl: false,
  },
  publicUrlRequired: false,
  activeProvider: { id: "s3", name: "S3" },
  builderUploadConfigured: false,
};

const LISTING = {
  hasOrganization: true,
  canManageOrg: true,
  providers: [
    {
      provider: "anthropic",
      label: "Anthropic",
      org: { scope: "org", updatedAt: 1 },
      personal: null,
    },
  ],
} as unknown as ModelProvidersListing;

function builderFlow(connected: boolean) {
  return {
    hasFetchedStatus: true,
    configured: connected,
    connecting: false,
    error: null,
    effective: connected ? "org" : null,
    grants: connected ? { org: { connectedAt: 1, needsReconnect: false } } : {},
    canConnect: { org: true, personal: false },
    start: vi.fn(),
  };
}

const CONTEXT = {
  role: "admin",
  isOwner: false,
  isAdmin: true,
  hasOrganization: true,
  soloDeploymentAdmin: false,
  appId: "clips",
  labs: {},
  flags: {},
} as never;

function row(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No row ${id}`);
  return element;
}

function button(scope: ParentNode, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No button ${label}`);
  return found as HTMLButtonElement;
}

async function flush() {
  // React Query delivers results on a timer, not a microtask.
  await act(async () => {
    for (let index = 0; index < 3; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

describe("InfrastructureSettingsPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let servicesRead: ServiceProvidersStatus;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    servicesRead = servicesStatus();
    state.queries = {
      "get-infrastructure-status": infraStatus(),
      "get-file-storage": STORAGE,
      "list-model-providers": LISTING,
    };
    state.errors = new Set();
    state.builder = builderFlow(false);
    callActionMock.mockReset();
    callActionMock.mockImplementation(
      async (name: string, params: { service?: string }) => {
        if (name === "manage-service-providers" && !params?.service) {
          return servicesRead;
        }
        throw new Error(`unexpected ${name}`);
      },
    );
    navigateMock.mockReset();
    toastMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    providerDialog.last = null;
    serviceKeyDialog.last = null;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
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

  async function render(context = CONTEXT) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <InfrastructureSettingsPage
            pageId="infra"
            sub={null}
            context={context}
            bridge={{} as never}
          />
        </QueryClientProvider>,
      );
    });
    await flush();
  }

  it("shows a layout-matching skeleton until every read settles", async () => {
    state.queries["get-infrastructure-status"] = undefined;
    await render();
    expect(
      container.querySelector("[data-infrastructure-skeleton]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-infrastructure-settings]"),
    ).toBeNull();
  });

  it("shows live environment status: database host, app addresses, variables", async () => {
    await render();
    expect(row("database").textContent).toContain(
      "Neon Postgres, set on your host. Every app shares it.",
    );
    expect(row("hosting").textContent).toContain(
      "Netlify. The workspace deploys every app to its own address.",
    );
    expect(row("variables").textContent).toContain(
      "DATABASE_URL and A2A_SECRET are set on your host.",
    );

    act(() => button(row("database"), "View").click());
    const database = document.querySelector(
      '[data-environment-dialog="database"]',
    );
    expect(database?.textContent).toContain(
      "ep-quiet-sun-a1b2c3.us-east-2.aws.neon.tech",
    );
    expect(database?.textContent).toContain("CLIPS_DATABASE_URL");
    act(() => button(database!, "Close").click());

    act(() => button(row("hosting"), "View").click());
    const hosting = document.querySelector(
      '[data-environment-dialog="hosting"]',
    );
    expect(hosting?.textContent).toContain("https://apps.example.com/dispatch");
    expect(hosting?.textContent).toContain("https://clips.example.com");
  });

  it("names a missing required variable and tags the row", async () => {
    state.queries["get-infrastructure-status"] = infraStatus({
      variables: [
        { key: "DATABASE_URL", required: true, set: true },
        { key: "A2A_SECRET", required: true, set: false },
      ],
    });
    await render();
    expect(row("variables").textContent).toContain(
      "Set A2A_SECRET on your host.",
    );
    expect(row("variables").textContent).toContain("Required");
    act(() => button(row("variables"), "View").click());
    const dialog = document.querySelector(
      '[data-environment-dialog="variables"]',
    );
    expect(
      dialog
        ?.querySelector('[data-variable="A2A_SECRET"]')
        ?.getAttribute("data-variable-set"),
    ).toBe("false");
  });

  it("lists the services with their source and what uses them, and no Email row", async () => {
    await render();
    expect(row("ai-model").textContent).toContain("Anthropic · Every app");
    expect(row("uploads").textContent).toContain(
      "Cloudflare R2, bucket clips-recordings · Uploads in every app",
    );
    expect(row("voice").textContent).toContain(
      "Not set up · Dictation in every app",
    );
    expect(row("voice").textContent).toContain("Recommended");
    expect(row("images").querySelector("[data-setup-tag]")).toBeNull();
    expect(container.textContent).not.toContain("Email");
  });

  it("recommends Builder.io first, with the page's one primary action", async () => {
    await render();
    const setup = row("setup");
    expect(setup.querySelector("h2")?.textContent).toBe("Recommended");
    expect(row("builder").textContent).toContain(
      "Power every service below with your Builder.io account credits. Free tier available.",
    );
    const primaries = [...container.querySelectorAll("button")].filter(
      (candidate) => candidate.classList.contains("bg-primary"),
    );
    expect(primaries).toEqual([button(row("builder"), "Connect")]);
    act(() => button(row("builder"), "Connect").click());
    expect(state.builder.start).toHaveBeenCalledWith({
      provisionAccount: false,
      scope: "org",
    });
  });

  it("says Builder-only services come with Builder.io and connects it in place", async () => {
    await render();
    for (const id of [
      "design-system-intelligence",
      "background",
      "browser-automation",
    ]) {
      expect(row(id).querySelector("[data-builder-only]")?.textContent).toBe(
        "Builder.io only",
      );
      expect(row(id).textContent).toContain("Available with Builder.io · ");
      expect(row(id).textContent).not.toContain("Not available");
      const connect = button(row(id), "Connect Builder.io");
      expect(connect.classList.contains("border")).toBe(true);
    }
    act(() => button(row("browser-automation"), "Connect Builder.io").click());
    expect(state.builder.start).toHaveBeenCalledWith({
      provisionAccount: false,
      scope: "org",
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("keeps the Setup heading and no connect when Builder.io can't be connected", async () => {
    state.builder = {
      ...builderFlow(false),
      canConnect: { org: false, personal: false },
    };
    await render();
    expect(row("setup").querySelector("h2")?.textContent).toBe("Setup");
    expect(row("builder").textContent).toContain("Not connected.");
    expect(row("builder").querySelector("button")).toBeNull();
    expect(row("background").textContent).toContain("Builder.io only");
    expect(row("background").querySelector("button")).toBeNull();
  });

  it("shows Builder.io as the source once it's connected", async () => {
    state.builder = builderFlow(true);
    await render();
    expect(row("builder").textContent).toContain(
      "Connected. Your account credits power every service marked Builder.io.",
    );
    expect(row("ai-model").textContent).toContain(
      "Builder.io and Anthropic · Every app",
    );
    expect(row("background").textContent).toContain(
      "Builder.io · Makes code changes from production.",
    );
    expect(row("setup").querySelector("h2")?.textContent).toBe("Setup");
    expect(row("background").querySelector("[data-builder-only]")).toBeNull();
    expect(row("background").querySelector("button")).toBeNull();
    act(() => button(row("builder"), "Manage").click());
    expect(navigateMock).toHaveBeenCalledWith("integrations", "builder");
  });

  it("updates a service row before the server answers, then keeps its answer", async () => {
    let resolveSet: (value: ServiceProvidersStatus) => void = () => {};
    callActionMock.mockImplementation(
      (name: string, params: { service?: string }) => {
        if (!params?.service) return Promise.resolve(servicesRead);
        return new Promise((resolve) => {
          resolveSet = resolve;
        });
      },
    );
    await render();
    act(() => button(row("voice"), "Set up").click());
    const dialog = document.querySelector('[data-service-dialog="voice"]')!;
    expect(dialog.textContent).toContain(
      "Uses the organization Google Gemini key.",
    );
    act(() => button(dialog, "Save").click());
    // The write is still in flight.
    await flush();

    expect(row("voice").textContent).toContain(
      "Google Gemini · Dictation in every app",
    );
    expect(callActionMock).toHaveBeenCalledWith("manage-service-providers", {
      service: "voice",
      provider: "gemini",
    });

    const saved = servicesStatus([
      { ...service("voice", { gemini: "org" }, "gemini"), provider: "gemini" },
      service("images", {}),
      service("embeddings", {}),
    ]);
    await act(async () => resolveSet(saved));
    await flush();
    expect(row("voice").textContent).toContain("Google Gemini");
    expect(toastMock.success).toHaveBeenCalledWith(
      "Voice input now uses Google Gemini.",
    );
  });

  it("rolls the row back and keeps the dialog open with the reason when the change fails", async () => {
    callActionMock.mockImplementation(
      async (_name: string, params: { service?: string }) => {
        if (!params?.service) return servicesRead;
        throw new Error(
          "Only organization owners and admins can change services.",
        );
      },
    );
    await render();
    act(() => button(row("voice"), "Set up").click());
    act(() =>
      button(
        document.querySelector('[data-service-dialog="voice"]')!,
        "Save",
      ).click(),
    );
    await flush();
    expect(row("voice").textContent).toContain("Not set up");
    const alert = document.querySelector(
      '[data-service-dialog="voice"] [role="alert"]',
    );
    expect(alert?.textContent).toContain("Couldn't change Voice input.");
    expect(alert?.textContent).toContain(
      "Only organization owners and admins can change services.",
    );
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("shows Saving on the primary button until the write settles", async () => {
    let resolveSet: (value: ServiceProvidersStatus) => void = () => {};
    callActionMock.mockImplementation(
      (name: string, params: { service?: string }) => {
        if (!params?.service) return Promise.resolve(servicesRead);
        return new Promise((resolve) => {
          resolveSet = resolve;
        });
      },
    );
    await render();
    act(() => button(row("voice"), "Set up").click());
    act(() =>
      button(
        document.querySelector('[data-service-dialog="voice"]')!,
        "Save",
      ).click(),
    );
    await flush();
    const dialog = document.querySelector('[data-service-dialog="voice"]');
    // The spinner's inline <style> is part of the button's text content.
    const saving = [...dialog!.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.endsWith("Saving…"),
    );
    expect(saving?.disabled).toBe(true);
    expect(button(dialog!, "Cancel").disabled).toBe(false);

    await act(async () => resolveSet(servicesRead));
    await flush();
    expect(document.querySelector('[data-service-dialog="voice"]')).toBeNull();
  });

  it("sends an AI model with no provider to Model, where the empty state starts setup", async () => {
    state.queries["list-model-providers"] = {
      ...LISTING,
      providers: [],
    } as unknown as ModelProvidersListing;
    await render();
    expect(row("ai-model").textContent).toContain("Not set up · Every app");
    expect(row("ai-model").textContent).toContain("Required");
    act(() => button(row("ai-model"), "Set up").click());
    expect(navigateMock).toHaveBeenCalledWith("model");
    expect(providerDialog.last?.open).toBe(false);
  });

  it("adds a Voyage key in place, then uses it for the service", async () => {
    servicesRead = servicesStatus([
      service("voice", { gemini: "org" }),
      service("images", {}),
      { ...service("embeddings", {}), provider: "voyage" },
    ]);
    await render();
    act(() => button(row("embeddings"), "Set up").click());
    const dialog = document.querySelector(
      '[data-service-dialog="embeddings"]',
    )!;
    act(() => button(dialog, "Add Voyage AI").click());
    expect(navigateMock).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-service-dialog="embeddings"]'),
    ).toBeNull();
    expect(serviceKeyDialog.last).toMatchObject({
      open: true,
      mode: "add",
      keyName: "VOYAGE_API_KEY",
    });

    callActionMock.mockImplementation(async () => servicesRead);
    act(() => serviceKeyDialog.last.onSaved());
    expect(callActionMock).toHaveBeenCalledWith("manage-service-providers", {
      service: "embeddings",
      provider: "voyage",
    });
  });

  it("opens the saved Voyage key in place from Manage key", async () => {
    servicesRead = servicesStatus([
      service("voice", { gemini: "org" }),
      service("images", {}),
      {
        ...service("embeddings", { voyage: "org" }, "voyage"),
        provider: "voyage",
      },
    ]);
    await render();
    act(() => button(row("embeddings"), "Manage").click());
    const dialog = document.querySelector(
      '[data-service-dialog="embeddings"]',
    )!;
    act(() => button(dialog, "Manage key").click());
    expect(navigateMock).not.toHaveBeenCalled();
    expect(serviceKeyDialog.last).toMatchObject({
      open: true,
      mode: "manage",
      keyName: "VOYAGE_API_KEY",
    });
  });

  it("adds a missing key through the provider dialog, then uses it", async () => {
    servicesRead = servicesStatus([
      service("voice", { groq: "personal" }),
      service("images", {}),
      service("embeddings", {}),
    ]);
    await render();
    act(() => button(row("voice"), "Set up").click());
    const dialog = document.querySelector('[data-service-dialog="voice"]')!;
    // No organization key yet, so the dialog opens on the first provider.
    expect(dialog.textContent).toContain(
      "Services use organization keys, and there's no Google Gemini key yet.",
    );
    act(() => button(dialog, "Add Google Gemini").click());
    expect(providerDialog.last).toMatchObject({
      open: true,
      mode: "add-from-service",
      provider: "google",
      serviceLabel: "Voice input",
    });

    callActionMock.mockImplementation(async () => servicesRead);
    act(() =>
      providerDialog.last.onSaved({ provider: "google", scope: "org" }),
    );
    expect(callActionMock).toHaveBeenCalledWith("manage-service-providers", {
      service: "voice",
      provider: "gemini",
    });
  });

  it("opens the storage form in a dialog", async () => {
    await render();
    act(() => button(row("uploads"), "Manage").click());
    expect(
      document.querySelector(
        "[data-storage-dialog] [data-testid=storage-form]",
      ),
    ).not.toBeNull();
  });

  it("reports a failed read on its row instead of an empty state", async () => {
    state.errors.add("get-file-storage");
    await render();
    expect(row("uploads").textContent).toContain("Couldn't load this.");
    expect(row("uploads").textContent).not.toContain("Not set up");
  });
});
