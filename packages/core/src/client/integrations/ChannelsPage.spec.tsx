// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChannelCredentialStatus,
  MessagingChannelsStatus,
  MessagingChannelStatus,
} from "../../integrations/channel-settings.js";
import englishMessages from "../../localization/core-messages/en-US.js";
import type { SettingsShellContextValue } from "../settings/shell/context.js";
import type { SettingsPageContext } from "../settings/shell/registry.js";

const actions = vi.hoisted(() => ({
  list: vi.fn(),
  manage: vi.fn(),
}));

const agent = vi.hoisted(() => ({ submitToAgent: vi.fn() }));
vi.mock("../CommandMenu.js", () => agent);

// The hooks' transport belongs to the framework. The page's contract is which
// action it calls with what, and what it does with the answer.
vi.mock("../use-action.js", async () => {
  const { useMutation, useQuery, useQueryClient } =
    await import("@tanstack/react-query");
  const call = (name: string, params: unknown) =>
    name === "list-messaging-channels"
      ? actions.list(params)
      : actions.manage(params);
  return {
    useActionQuery: (name: string, params?: unknown) =>
      useQuery({
        queryKey: ["action", name, params],
        queryFn: () => call(name, params),
      }),
    useActionMutation: (name: string, options: Record<string, any> = {}) => {
      const queryClient = useQueryClient();
      return useMutation({
        ...options,
        mutationFn: (params: unknown) => call(name, params),
        onSuccess: (...args: unknown[]) => {
          void queryClient.invalidateQueries({ queryKey: ["action"] });
          return options.onSuccess?.(...args);
        },
      });
    },
    actionErrorMessage: (error: unknown) =>
      (error as { actionMessage?: string } | undefined)?.actionMessage,
  };
});

vi.mock("../i18n.js", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, unknown>): string => {
      const messages = englishMessages as Record<string, string>;
      const message =
        messages[key.replace(/^agentChat\./, "")] ??
        (key === "common.cancel" ? "Cancel" : key);
      return message.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? ""),
      );
    },
}));

import { SettingsShellProvider } from "../settings/shell/context.js";
import { registerChannelSettingsExtensions } from "./channel-extensions.js";
import { ChannelsPage } from "./ChannelsPage.js";

const OWNER: SettingsPageContext = {
  role: "owner",
  isOwner: true,
  isAdmin: true,
  hasOrganization: true,
  soloDeploymentAdmin: false,
  appId: "clips",
  labs: {},
  flags: {},
};
const MEMBER: SettingsPageContext = {
  ...OWNER,
  role: "member",
  isOwner: false,
  isAdmin: false,
};

const REQUIRED_KEYS: Record<string, string[]> = {
  slack: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"],
  "google-docs": ["GOOGLE_SERVICE_ACCOUNT_KEY"],
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"],
  whatsapp: [
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_APP_SECRET",
  ],
  discord: ["DISCORD_APPLICATION_ID", "DISCORD_PUBLIC_KEY"],
  "microsoft-teams": ["MICROSOFT_TEAMS_APP_ID"],
  email: ["EMAIL_AGENT_ADDRESS"],
};

type ChannelPatch = Partial<Omit<MessagingChannelStatus, "credentials">> & {
  sources?: Record<string, ChannelCredentialStatus["source"]>;
};

function channel(
  platform: string,
  { sources = {}, ...patch }: ChannelPatch = {},
): MessagingChannelStatus {
  const configured = patch.configured ?? false;
  const enabled = patch.enabled ?? false;
  return {
    platform,
    label: platform,
    configured,
    enabled,
    state: !configured ? "not-set-up" : enabled ? "on" : "off",
    webhookUrl: `https://clips.example.com/_agent-native/integrations/${platform}/webhook`,
    credentials: (REQUIRED_KEYS[platform] ?? []).map((key) => ({
      key,
      label: key,
      required: key !== "SLACK_BOT_TOKEN",
      saveable: key !== "GOOGLE_SERVICE_ACCOUNT_KEY",
      source: sources[key] ?? null,
      removable: sources[key] === "saved",
    })),
    ...patch,
  };
}

function listed(
  patches: Record<string, ChannelPatch> = {},
  canManage = true,
): MessagingChannelsStatus {
  return {
    canManage,
    channels: Object.keys(REQUIRED_KEYS).map((platform) =>
      channel(platform, patches[platform]),
    ),
  };
}

function actionError(message: string) {
  return Object.assign(new Error(`Action failed: ${message}`), {
    actionMessage: message,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("ChannelsPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let headerRoot: Root;
  let headerContainer: HTMLDivElement;
  let navigate: ReturnType<typeof vi.fn>;
  let setHeader: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;
  let cleanups: Array<() => void>;

  function Providers({ children }: { children: ReactNode }) {
    const shell: SettingsShellContextValue = {
      route: { page: "channels", sub: null },
      navigate: navigate as SettingsShellContextValue["navigate"],
      setHeader: setHeader as SettingsShellContextValue["setHeader"],
    };
    return (
      <QueryClientProvider client={queryClient}>
        <SettingsShellProvider value={shell}>{children}</SettingsShellProvider>
      </QueryClientProvider>
    );
  }

  async function render(sub: string | null, context = OWNER) {
    await act(async () => {
      root.render(
        <Providers>
          <ChannelsPage sub={sub} context={context} appName="Clips" />
        </Providers>,
      );
    });
    await flush();
  }

  /** Render the header action the page handed the shell. */
  async function renderHeaderAction() {
    const header = setHeader.mock.calls.at(-1)?.[0] as
      | { action?: ReactNode }
      | null
      | undefined;
    await act(async () => {
      headerRoot.render(<Providers>{header?.action ?? null}</Providers>);
    });
    return headerContainer.querySelector("button");
  }

  async function openSetup() {
    const setUp = await renderHeaderAction();
    await act(async () => setUp?.click());
    await flush();
    return setUp;
  }

  const rowLabels = () =>
    Array.from(
      container.querySelectorAll(".agent-native-settings-row"),
      (row) => row.querySelector("span.text-sm")?.textContent,
    );
  const rowText = (id: string) =>
    container.querySelector(`[id="${id}"]`)?.textContent ?? "";
  const buttonNamed = (name: string, scope: ParentNode = document) =>
    Array.from(scope.querySelectorAll("button")).find(
      (button) => button.textContent === name,
    );
  const type = async (id: string, value: string) => {
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>(`#${id}`);
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    headerContainer = document.createElement("div");
    document.body.append(container, headerContainer);
    root = createRoot(container);
    headerRoot = createRoot(headerContainer);
    navigate = vi.fn();
    setHeader = vi.fn();
    cleanups = [];
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    actions.list.mockResolvedValue(listed());
    actions.manage.mockImplementation(async (args: { platform: string }) => ({
      channel: channel(args.platform),
      message: "ok",
    }));
  });

  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    act(() => root.unmount());
    act(() => headerRoot.unmount());
    container.remove();
    headerContainer.remove();
    document.body.innerHTML = "";
    queryClient.clear();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists every channel from the catalog in spec order with its state", async () => {
    actions.list.mockResolvedValue(
      listed({
        slack: { configured: true, enabled: true },
        telegram: { configured: true, enabled: false },
        // Enabled without credentials receives nothing, so it isn't "On".
        whatsapp: { configured: false, enabled: true },
      }),
    );
    await render(null);

    expect(rowLabels()).toEqual([
      "Slack",
      "Google Docs",
      "Telegram",
      "WhatsApp",
      "Discord",
      "Microsoft Teams",
      "Email",
    ]);
    expect(rowText("slack")).toContain("On");
    expect(rowText("telegram")).toContain("Off");
    expect(rowText("whatsapp")).toContain("Not set up");
    expect(
      container.querySelector('a[aria-label="Manage Slack"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('a[aria-label="Set up WhatsApp"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "Where people can message the Clips agent. Each app's agent is set up separately.",
    );
  });

  it("opens a channel inside the shell", async () => {
    await render(null);
    const link = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Set up Telegram"]',
    );
    expect(link?.getAttribute("href")).toContain("/settings/channels/telegram");
    // The whole row is the link to the channel's page: no button inside,
    // a trailing chevron, and the state read as its description.
    expect(link?.id).toBe("telegram");
    expect(link?.querySelector("button")).toBeNull();
    expect(link?.querySelector("svg.tabler-icon-chevron-right")).not.toBeNull();
    expect(
      document.getElementById(link!.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Chat with your agent via a Telegram bot. Not set up.");
    expect(container.querySelector("[data-channels-page] button")).toBeNull();
    await act(async () => link?.click());
    expect(navigate).toHaveBeenCalledWith("channels", "telegram");
  });

  it("shows members a View link and no setup", async () => {
    actions.list.mockResolvedValue(listed({}, false));
    await render(null, MEMBER);
    expect(
      container.querySelector('a[aria-label="View Slack"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Set up");
    expect(container.textContent).not.toContain("Manage");
  });

  it("leaves out channels this deployment doesn't mount", async () => {
    actions.list.mockResolvedValue({
      canManage: true,
      channels: [channel("slack"), channel("telegram")],
    });
    await render(null);
    expect(rowLabels()).toEqual(["Slack", "Telegram"]);
  });

  it("shows an empty state inside the card when no channel is mounted", async () => {
    actions.list.mockResolvedValue({ canManage: true, channels: [] });
    await render(null);
    const empty = container.querySelector(
      "#channel-list [data-channels-empty]",
    );
    expect(empty?.textContent).toBe("No channels are available in Clips.");
  });

  it("says so when the channel list can't load", async () => {
    actions.list.mockRejectedValue(new Error("HTTP 500"));
    await render(null);
    expect(container.textContent).toContain("Couldn't load channels.");
    expect(container.textContent).not.toContain("Not set up");
  });

  it("turns a channel on before the server answers and rolls back on failure", async () => {
    actions.list.mockResolvedValue(listed({ telegram: { configured: true } }));
    const pending = deferred<unknown>();
    actions.manage.mockReturnValue(pending.promise);
    await render("telegram");

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Turn on Telegram"]',
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle?.click());
    await flush();

    expect(actions.manage).toHaveBeenCalledWith({
      operation: "enable",
      platform: "telegram",
    });
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(rowText("status")).toContain("On");

    await act(async () => {
      pending.reject(
        actionError(englishMessages["settingsShell.channels.membersFootnote"]),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    expect(
      container
        .querySelector('button[role="switch"]')
        ?.getAttribute("aria-checked"),
    ).toBe("false");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Only owners and admins can set up channels.",
    );
  });

  it("shows members the state only", async () => {
    actions.list.mockResolvedValue(
      listed({ telegram: { configured: true, enabled: true } }, false),
    );
    await render("telegram", MEMBER);

    expect(container.querySelector('button[role="switch"]')).toBeNull();
    expect(rowText("status")).toContain("On");
    expect(container.querySelector('[id="credentials"]')).toBeNull();
    expect(container.textContent).toContain(
      "Only owners and admins can set up channels.",
    );
    expect(
      (setHeader.mock.calls.at(-1)?.[0] as { action?: ReactNode }).action,
    ).toBeNull();
  });

  it("shows members Slack's state with a lock instead of Set up", async () => {
    actions.list.mockResolvedValue(
      listed({ slack: { configured: true, enabled: true } }, false),
    );
    await render("slack", MEMBER);

    expect(rowText("mention")).toContain("Mention the agent");
    expect(rowText("mention")).toContain("On");
    expect(container.querySelector("#mention button")).toBeNull();
    expect(
      container.querySelector("#mention svg.tabler-icon-lock"),
    ).not.toBeNull();
    expect(container.querySelector('button[role="switch"]')).toBeNull();
  });

  it("copies the webhook URL the server reports", async () => {
    await render("whatsapp");
    expect(rowText("webhook-url")).toContain(
      "https://clips.example.com/_agent-native/integrations/whatsapp/webhook",
    );
    expect(
      container.querySelector('button[aria-label="Copy webhook URL"]'),
    ).not.toBeNull();
  });

  it("explains a webhook URL providers can't reach", async () => {
    actions.list.mockResolvedValue(
      listed({
        whatsapp: {
          webhookUrl:
            "http://localhost:8080/_agent-native/integrations/whatsapp/webhook",
        },
      }),
    );
    await render("whatsapp");
    expect(rowText("webhook-url")).toContain(
      "WhatsApp can't reach this address",
    );
    expect(
      container.querySelector('button[aria-label="Copy webhook URL"]'),
    ).toBeNull();
  });

  it("offers an input for each of the adapter's own variables in any app", async () => {
    await render("whatsapp");
    const setUp = await openSetup();
    expect(setUp?.textContent).toBe("Set up");

    const keys = Array.from(
      document.querySelectorAll("[data-channel-credential]"),
      (node) => node.getAttribute("data-channel-credential"),
    );
    expect(keys).toEqual(REQUIRED_KEYS.whatsapp);
    expect(keys).not.toContain("WHATSAPP_TOKEN");
    for (const key of REQUIRED_KEYS.whatsapp) {
      expect(document.querySelector(`#channel-whatsapp-${key}`)).not.toBeNull();
    }
    expect(buttonNamed("Save and turn on")?.disabled).toBe(true);
  });

  it("points deployment-only keys at the deployment environment", async () => {
    await render("google-docs");
    await openSetup();
    expect(
      document.querySelector("#channel-google-docs-GOOGLE_SERVICE_ACCOUNT_KEY"),
    ).toBeNull();
    expect(document.body.textContent).toContain(
      "Add this to the deployment environment",
    );
    expect(buttonNamed("Close")).toBeDefined();
    expect(buttonNamed("Save and turn on")).toBeUndefined();
  });

  it("saves the variables and turns the channel on", async () => {
    actions.manage.mockImplementation(
      async (args: { operation: string; platform: string }) => ({
        channel: channel(args.platform, {
          configured: true,
          enabled: args.operation === "enable",
        }),
        message: "ok",
      }),
    );
    await render("telegram");
    await openSetup();

    expect(buttonNamed("Save and turn on")?.disabled).toBe(true);
    await type("channel-telegram-TELEGRAM_BOT_TOKEN", "fake-bot-token");
    await type("channel-telegram-TELEGRAM_WEBHOOK_SECRET", "fake-secret");
    expect(buttonNamed("Save and turn on")?.disabled).toBe(false);

    await act(async () => buttonNamed("Save and turn on")?.click());
    await flush();

    expect(actions.manage.mock.calls.map(([args]) => args)).toEqual([
      {
        operation: "save-credentials",
        platform: "telegram",
        values: {
          TELEGRAM_BOT_TOKEN: "fake-bot-token",
          TELEGRAM_WEBHOOK_SECRET: "fake-secret",
        },
      },
      { operation: "enable", platform: "telegram" },
    ]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("doesn't turn a channel on when the server still reports it unset", async () => {
    actions.list.mockResolvedValue(
      listed({ discord: { sources: { DISCORD_PUBLIC_KEY: "saved" } } }),
    );
    await render("discord");
    await openSetup();
    await type("channel-discord-DISCORD_APPLICATION_ID", "fake-app-id");
    await act(async () => buttonNamed("Save and turn on")?.click());
    await flush();

    expect(actions.manage).toHaveBeenCalledTimes(1);
    expect(actions.manage).toHaveBeenCalledWith({
      operation: "save-credentials",
      platform: "discord",
      values: { DISCORD_APPLICATION_ID: "fake-app-id" },
    });
    expect(document.body.textContent).toContain(
      "Some required variables are still missing.",
    );
  });

  it("replaces a saved key without turning the channel off", async () => {
    actions.list.mockResolvedValue(
      listed({
        slack: {
          configured: true,
          enabled: true,
          sources: { SLACK_SIGNING_SECRET: "saved" },
        },
      }),
    );
    await render("slack");
    const manage =
      container.querySelector<HTMLButtonElement>("#mention button");
    expect(manage?.textContent).toBe("Manage");
    await act(async () => manage?.click());
    await flush();

    const saved = document.querySelector(
      '[data-channel-credential="SLACK_SIGNING_SECRET"]',
    );
    expect(saved?.textContent).toContain("Saved");
    expect(
      document.querySelector("#channel-slack-SLACK_SIGNING_SECRET"),
    ).toBeNull();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Replace SLACK_SIGNING_SECRET"]',
        )
        ?.click(),
    );
    await type("channel-slack-SLACK_SIGNING_SECRET", "fake-new-secret");
    await act(async () => buttonNamed("Save")?.click());
    await flush();

    expect(actions.manage.mock.calls.map(([args]) => args)).toEqual([
      {
        operation: "save-credentials",
        platform: "slack",
        values: { SLACK_SIGNING_SECRET: "fake-new-secret" },
      },
    ]);
  });

  it("shows keys the deployment sets without an input", async () => {
    actions.list.mockResolvedValue(
      listed({
        telegram: {
          sources: {
            TELEGRAM_BOT_TOKEN: "environment",
            TELEGRAM_WEBHOOK_SECRET: "elsewhere",
          },
          configured: true,
        },
      }),
    );
    await render("telegram");
    await openSetup();
    expect(
      document.querySelector('[data-channel-credential="TELEGRAM_BOT_TOKEN"]')
        ?.textContent,
    ).toContain("Set in the deployment environment");
    expect(
      document.querySelector(
        '[data-channel-credential="TELEGRAM_WEBHOOK_SECRET"]',
      )?.textContent,
    ).toContain("Saved outside Channels");
    expect(document.querySelector("input")).toBeNull();
  });

  it("removes saved credentials after a confirm", async () => {
    actions.list.mockResolvedValue(
      listed({
        telegram: {
          configured: true,
          enabled: true,
          sources: {
            TELEGRAM_BOT_TOKEN: "saved",
            TELEGRAM_WEBHOOK_SECRET: "saved",
          },
        },
      }),
    );
    await render("telegram");
    expect(rowText("credentials")).toContain(
      "TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET",
    );

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove Telegram credentials"]',
        )
        ?.click(),
    );
    await flush();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Remove Telegram credentials?");
    expect(dialog?.textContent).toContain("TELEGRAM_WEBHOOK_SECRET");
    expect(actions.manage).not.toHaveBeenCalled();

    await act(async () => buttonNamed("Remove", dialog!)?.click());
    await flush();
    expect(actions.manage).toHaveBeenCalledWith({
      operation: "remove-credentials",
      platform: "telegram",
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("keeps the confirm open with the server's reason when removal fails", async () => {
    actions.list.mockResolvedValue(
      listed({
        telegram: {
          configured: true,
          sources: { TELEGRAM_BOT_TOKEN: "saved" },
        },
      }),
    );
    actions.manage.mockRejectedValue(
      actionError("Only organization owners and admins can set up channels."),
    );
    await render("telegram");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove Telegram credentials"]',
        )
        ?.click(),
    );
    await flush();
    const dialog = document.querySelector('[role="alertdialog"]');
    await act(async () => buttonNamed("Remove", dialog!)?.click());
    await flush();
    expect(
      document.querySelector('[role="alertdialog"] [role="alert"]')
        ?.textContent,
    ).toBe("Only organization owners and admins can set up channels.");
  });

  it("registers Telegram's webhook through the action", async () => {
    actions.list.mockResolvedValue(
      listed({ telegram: { configured: true, enabled: true } }),
    );
    await render("telegram");
    await act(async () => buttonNamed("Register", container)?.click());
    await flush();
    expect(actions.manage).toHaveBeenCalledWith({
      operation: "register-webhook",
      platform: "telegram",
    });
    expect(rowText("webhook-registration")).toContain("Registered");
  });

  it("shows Google Docs' service account and no webhook URL", async () => {
    actions.list.mockResolvedValue(
      listed({
        "google-docs": {
          configured: true,
          details: { serviceAccountEmail: "agent@fake-project.iam.example" },
        },
      }),
    );
    await render("google-docs");
    expect(rowText("service-account")).toContain(
      "agent@fake-project.iam.example",
    );
    expect(container.querySelector('[id="webhook-url"]')).toBeNull();
  });

  it("renders an app's Slack settings next to the agent in Slack", async () => {
    cleanups.push(
      registerChannelSettingsExtensions([
        {
          id: "link-previews",
          platform: "slack",
          component: ({ platform }) => (
            <section data-testid="link-previews">
              Link previews {platform}
            </section>
          ),
        },
      ]),
    );
    await render("slack");
    expect(
      container.querySelector('[data-testid="link-previews"]')?.textContent,
    ).toBe("Link previews slack");
    expect(
      Array.from(container.querySelectorAll("h2"), (h) => h.textContent),
    ).toContain("Agent in Slack");
  });

  it("lays Slack out as the agent in Slack, with Set up on its row", async () => {
    await render("slack");
    expect(
      Array.from(container.querySelectorAll("h2"), (h) => h.textContent),
    ).toEqual(["Agent in Slack"]);
    expect(rowText("mention")).toContain(
      "@mention the agent in a thread or DM it, and it replies in that thread.",
    );
    expect(
      (setHeader.mock.calls.at(-1)?.[0] as { action?: ReactNode }).action,
    ).toBeNull();
    await act(async () => buttonNamed("Set up", container)?.click());
    await flush();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Set up Slack",
    );
  });

  it("uses the Connection and Information groups for other channels", async () => {
    await render("telegram");
    expect(
      Array.from(container.querySelectorAll("h2"), (h) => h.textContent),
    ).toEqual(["Connection", "Information"]);
    expect(rowText("developer")).toContain("Telegram");
    expect(rowText("category")).toContain("Channels");
  });

  it("shows each channel's brand logo, and Email's icon", async () => {
    await render(null);
    for (const id of [
      "slack",
      "google-docs",
      "telegram",
      "whatsapp",
      "discord",
      "microsoft-teams",
    ]) {
      expect(
        container.querySelector(`a[id="${id}"] img`)?.getAttribute("src"),
      ).toMatch(/^data:image\//);
    }
    expect(container.querySelector('a[id="email"] img')).toBeNull();
    expect(
      container.querySelector('a[id="email"] svg.tabler-icon-mail'),
    ).not.toBeNull();
  });

  it("names the channel with its logo in the breadcrumb", async () => {
    await render("whatsapp");
    const header = setHeader.mock.calls.at(-1)?.[0] as { title?: ReactNode };
    await act(async () => {
      headerRoot.render(<Providers>{header.title}</Providers>);
    });
    expect(headerContainer.textContent).toBe("WhatsApp");
    expect(headerContainer.querySelector("img")?.getAttribute("src")).toMatch(
      /^data:image\//,
    );
  });

  it("asks the agent when a hero prompt is clicked", async () => {
    await render("telegram");
    const hero = container.querySelector("[data-integration-hero]");
    expect(hero).not.toBeNull();
    const prompt = Array.from(hero!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Summarize today's recordings"),
    );
    await act(async () => prompt?.click());
    expect(agent.submitToAgent).toHaveBeenCalledWith(
      "Summarize today's recordings",
    );
    expect(container.textContent).toContain(
      "Chat with your agent via a Telegram bot. Each app's agent is set up separately.",
    );
  });

  it("keeps the breadcrumb on an unknown channel", async () => {
    await render("nope");
    expect(
      (setHeader.mock.calls.at(-1)?.[0] as { title?: ReactNode }).title,
    ).toBe("Not found");
    expect(
      container.querySelector("[data-channel-not-found]")?.textContent,
    ).toBe("This channel isn't available in Clips.");
  });
});
