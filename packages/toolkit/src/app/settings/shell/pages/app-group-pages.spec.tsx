// @vitest-environment happy-dom

import type { LabStates } from "@agent-native/core/client/labs/use-lab";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async () => {
  const english = (await import("../../../i18n/catalogs/en-US.js"))
    .default as Record<string, string>;
  const t = (key: string, options?: Record<string, unknown>) => {
    let text =
      english[key.replace(/^agentChat\./, "")] ??
      (typeof options?.defaultValue === "string" ? options.defaultValue : key);
    for (const [name, value] of Object.entries(options ?? {})) {
      text = text.replaceAll(`{{${name}}}`, String(value));
    }
    return text;
  };
  return { useT: () => t };
});

const modelDefault = vi.hoisted(() => ({
  fetch: vi.fn(),
  save: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("@agent-native/core/client/app-model-default", () => ({
  fetchAppModelDefault: modelDefault.fetch,
  saveAppModelDefault: modelDefault.save,
  resetAppModelDefault: modelDefault.reset,
}));

const labsActions = vi.hoisted(() => ({
  query: { data: undefined as LabStates | undefined },
  isError: false,
  mutate: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
  useChangeVersions: () => 0,
}));
vi.mock("@agent-native/core/client/use-action", () => ({
  useActionQuery: () => ({
    data: labsActions.query.data,
    isLoading: labsActions.query.data === undefined && !labsActions.isError,
    isError: labsActions.isError,
    refetch: vi.fn(),
  }),
  useActionMutation: () => ({
    mutate: labsActions.mutate,
    isPending: false,
  }),
}));

const orgState = vi.hoisted(() => ({
  value: {
    orgId: "org-1" as string | null,
    orgName: "Builder.io",
    role: "member",
  },
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: orgState.value }),
}));

const jobsTab = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));
vi.mock("../../../agent-page/AgentJobsTab.js", () => ({
  AgentJobsTab: (props: Record<string, unknown>) => {
    jobsTab.props = props;
    return <div data-testid="jobs" />;
  },
}));
vi.mock("../../../chat/index.js", () => ({
  AgentAskPopover: ({ label, title }: { label: string; title: string }) => (
    <button type="button" data-ask-title={title}>
      {label}
    </button>
  ),
}));
vi.mock("../../../resources/index.js", () => ({
  McpAccessSettings: ({
    appName,
    hideHeader,
  }: {
    appName: string;
    hideHeader: boolean;
  }) => (
    <div data-testid="mcp" data-app={appName} data-hide-header={hideHeader} />
  ),
}));
const changelogCard = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));
vi.mock("../../../changelog/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../changelog/index.js")>()),
  ChangelogSettingsCard: (props: Record<string, unknown>) => {
    changelogCard.props = props;
    return <div data-testid="changelog" />;
  },
}));

import type { SettingsTabItem } from "../../SettingsTabsPage.js";
import { createSettingsBridge, type SettingsBridgeInput } from "../bridge.js";
import {
  SettingsShellProvider,
  type SettingsPageHeader,
  type SettingsShellContextValue,
} from "../context.js";
import type { SettingsPageContext } from "../registry.js";
import AppGeneralSettingsPage from "./app.js";
import AutomationsSettingsPage from "./automations.js";
import LabsSettingsPage from "./labs.js";
import McpServerSettingsPage from "./mcp.js";
import WhatsNewSettingsPage from "./whats-new.js";

function pageContext(
  overrides: Partial<SettingsPageContext> = {},
): SettingsPageContext {
  return {
    role: "member",
    isOwner: false,
    isAdmin: false,
    hasOrganization: true,
    soloDeploymentAdmin: false,
    appId: "clips",
    labs: {},
    flags: {},
    ...overrides,
  };
}

const ENGINES = [
  {
    name: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-sonnet-5",
    supportedModels: ["claude-sonnet-5", "claude-opus-4-8"],
    configured: true,
  },
  {
    name: "ai-sdk:openai",
    label: "OpenAI",
    defaultModel: "gpt-5",
    supportedModels: ["gpt-5"],
    configured: false,
  },
];

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("app group pages", () => {
  let container: HTMLDivElement;
  let root: Root;
  let navigate: ReturnType<typeof vi.fn>;
  let header: SettingsPageHeader | null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    navigate = vi.fn();
    header = null;
    labsActions.query.data = undefined;
    labsActions.isError = false;
    orgState.value = { orgId: "org-1", orgName: "Builder.io", role: "member" };
    jobsTab.props = null;
    changelogCard.props = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderPage(
    Page: React.ComponentType<{
      pageId: string;
      sub: string | null;
      context: SettingsPageContext;
      bridge: ReturnType<typeof createSettingsBridge>;
    }>,
    {
      input = {},
      sub = null,
      context = pageContext(),
    }: {
      input?: SettingsBridgeInput;
      sub?: string | null;
      context?: SettingsPageContext;
    } = {},
  ) {
    const shell: SettingsShellContextValue = {
      route: { page: "app", sub },
      navigate,
      setHeader: (next) => {
        header = next;
      },
    };
    const bridge = createSettingsBridge({ appName: "Clips", ...input });
    await act(async () => {
      root.render(
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <SettingsShellProvider value={shell}>
            <Suspense fallback={null}>
              <Page pageId="page" sub={sub} context={context} bridge={bridge} />
            </Suspense>
          </SettingsShellProvider>
        </QueryClientProvider>,
      );
    });
    await flush();
  }

  describe("General", () => {
    it("puts core's default model and demo mode around the app's own groups", async () => {
      modelDefault.fetch.mockResolvedValue({
        appId: "clips",
        engine: null,
        model: null,
        source: "default",
        canUpdate: true,
        orgDefault: { engine: "anthropic", model: "claude-sonnet-5" },
        engines: ENGINES,
      });
      await renderPage(AppGeneralSettingsPage, {
        input: { general: <section data-testid="today">today</section> },
      });

      const text = container.textContent ?? "";
      expect(text).toContain("Agent");
      expect(text).toContain(
        "Used for new agent chats in Clips. The default is Sonnet 5.",
      );
      expect(container.querySelector('[data-testid="today"]')).not.toBeNull();
      expect(text).toContain("This browser");
      expect(text).toContain(
        "Use sample data in this browser for presentations.",
      );
      const trigger = container.querySelector<HTMLButtonElement>(
        '#app-models [role="combobox"]',
      );
      expect(trigger?.textContent).toContain("Use the default");
      expect(
        container.querySelector("#demo-mode [role='switch']"),
      ).not.toBeNull();
    });

    it("shows a member the app's model read-only", async () => {
      modelDefault.fetch.mockResolvedValue({
        appId: "clips",
        engine: "anthropic",
        model: "claude-opus-4-8",
        source: "org",
        canUpdate: false,
        orgDefault: null,
        engines: ENGINES,
      });
      await renderPage(AppGeneralSettingsPage);

      const row = container.querySelector("#app-models");
      expect(row?.querySelector('[role="combobox"]')).toBeNull();
      expect(row?.textContent).toContain("Opus 4.8");
      expect(row?.textContent).toContain("Used for new agent chats in Clips.");
    });

    it("says when the default model couldn't load instead of hiding it", async () => {
      modelDefault.fetch.mockRejectedValue(new Error("500"));
      await renderPage(AppGeneralSettingsPage);
      await flush();

      const row = container.querySelector("#app-models");
      expect(row?.textContent).toContain("Couldn't load the default model.");
      expect(row?.textContent).toContain("Retry");
    });

    it("shows app areas as tabs routed under app/", async () => {
      modelDefault.fetch.mockResolvedValue({
        appId: "clips",
        engine: null,
        model: null,
        source: "default",
        canUpdate: true,
        orgDefault: null,
        engines: ENGINES,
      });
      await renderPage(AppGeneralSettingsPage, {
        sub: "recordings",
        input: {
          appAreas: [
            {
              id: "recordings",
              label: "Recordings",
              content: <div data-testid="recordings">recordings</div>,
            },
            {
              id: "meetings",
              label: "Meetings",
              visible: false,
              content: <div>meetings</div>,
            },
          ],
        },
      });

      const tabs = [...container.querySelectorAll('[role="tab"]')].map(
        (tab) => tab.textContent,
      );
      expect(tabs).toEqual(["General", "Recordings"]);
      expect(
        container.querySelector('[role="tab"][data-state="active"]')
          ?.textContent,
      ).toBe("Recordings");
      expect(
        container.querySelector('[data-testid="recordings"]'),
      ).not.toBeNull();

      const general = container.querySelector<HTMLElement>('[role="tab"]');
      act(() => {
        general?.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, button: 0 }),
        );
      });
      expect(navigate).toHaveBeenCalledWith("app", null);
    });

    it("bridges today's app-area tabs too", async () => {
      modelDefault.fetch.mockResolvedValue({
        appId: "clips",
        engine: null,
        model: null,
        source: "default",
        canUpdate: true,
        orgDefault: null,
        engines: ENGINES,
      });
      const tab: SettingsTabItem = {
        id: "identity",
        label: "Identity",
        settingsPlacement: "app-area",
        content: <div>identity</div>,
      };
      await renderPage(AppGeneralSettingsPage, {
        input: { extraTabs: [tab] },
      });
      expect(
        [...container.querySelectorAll('[role="tab"]')].map(
          (item) => item.textContent,
        ),
      ).toEqual(["General", "Identity"]);
    });
  });

  describe("Labs", () => {
    const labs = [
      {
        key: "clips.wisprflow",
        displayName: "Voice dictation",
        description: "Show or hide voice dictation in Clips Desktop.",
        defaultEnabled: true,
      },
      { key: "clips.meetings", displayName: "Meetings and transcription" },
      { key: "clips.retired", displayName: "Retired lab" },
    ];

    function switchFor(label: string) {
      return container.querySelector<HTMLButtonElement>(
        `[role="switch"][aria-label="${label}"]`,
      );
    }

    it("groups app labs under the app's name with the footnote", async () => {
      await renderPage(LabsSettingsPage, { input: { labs } });
      const title = container.querySelector("#labs h2");
      expect(title?.textContent).toBe("Clips");
      expect(container.textContent).not.toContain("ChatGPT subscription");
      expect(container.textContent).toContain(
        "These new, unstable features may have bugs.",
      );
      expect(container.textContent).not.toContain("Your feedback");
    });

    it("shows a default-on lab on while the answer loads", async () => {
      await renderPage(LabsSettingsPage, { input: { labs } });
      expect(switchFor("Voice dictation")?.getAttribute("aria-checked")).toBe(
        "true",
      );
      expect(
        switchFor("Meetings and transcription")?.getAttribute("aria-checked"),
      ).toBe("false");
      expect(switchFor("Voice dictation")?.disabled).toBe(true);
    });

    it("keeps defaults and says so when the labs can't load", async () => {
      labsActions.isError = true;
      await renderPage(LabsSettingsPage, { input: { labs } });
      expect(switchFor("Voice dictation")?.getAttribute("aria-checked")).toBe(
        "true",
      );
      expect(container.textContent).toContain("Couldn't load your labs.");
    });

    it("hides labs the server didn't register once it answers", async () => {
      labsActions.query.data = {
        "chatgpt-subscription": {
          enabled: false,
          source: "default",
          mixed: false,
        },
        "clips.wisprflow": { enabled: false, source: "choice", mixed: false },
        "clips.meetings": { enabled: true, source: "choice", mixed: false },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });
      expect(switchFor("Retired lab")).toBeNull();
      expect(switchFor("Voice dictation")?.getAttribute("aria-checked")).toBe(
        "false",
      );
      expect(
        switchFor("Meetings and transcription")?.getAttribute("aria-checked"),
      ).toBe("true");
      expect(switchFor("Voice dictation")?.disabled).toBe(false);
    });

    it("refreshes the model catalog after a ChatGPT lab change succeeds", async () => {
      labsActions.query.data = {
        "chatgpt-subscription": {
          enabled: false,
          source: "default",
          mixed: false,
        },
      };
      const modelConfigChanged = vi.fn();
      window.addEventListener(
        "agent-engine:configured-changed",
        modelConfigChanged,
      );
      try {
        await renderPage(LabsSettingsPage, {
          input: {
            labs: [
              {
                key: "chatgpt-subscription",
                displayName: "ChatGPT plan access",
              },
            ],
          },
        });

        const toggle = switchFor("ChatGPT plan access");
        expect(toggle?.getAttribute("aria-checked")).toBe("false");

        for (const [index, enabled] of [true, false].entries()) {
          act(() => toggle?.click());
          const [variables, options] =
            labsActions.mutate.mock.calls[index] ?? [];
          expect(variables).toEqual({ key: "chatgpt-subscription", enabled });
          expect(modelConfigChanged).toHaveBeenCalledTimes(index);
          act(() => {
            (options as { onSuccess?: () => void } | undefined)?.onSuccess?.();
          });
          expect(modelConfigChanged).toHaveBeenCalledTimes(index + 1);
          expect(toggle?.getAttribute("aria-checked")).toBe(String(enabled));
        }
      } finally {
        window.removeEventListener(
          "agent-engine:configured-changed",
          modelConfigChanged,
        );
      }
    });

    it("offers explicit choices for inherited mixed settings", async () => {
      labsActions.query.data = {
        "clips.meetings": {
          enabled: false,
          source: "legacy",
          mixed: true,
          legacyValues: { capture: false, recovery: true },
        },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });
      expect(switchFor("Meetings and transcription")).toBeNull();
      const on = container.querySelector<HTMLButtonElement>(
        '[aria-label="Meetings and transcription: On"]',
      );
      expect(on?.disabled).toBe(false);
      act(() => on?.click());
      expect(labsActions.mutate).toHaveBeenCalledWith(
        { key: "clips.meetings", enabled: true },
        expect.any(Object),
      );
      expect(
        switchFor("Meetings and transcription")?.getAttribute("aria-checked"),
      ).toBe("true");
    });
  });

  describe("Automations", () => {
    it("passes a member's real role and organization, and puts New automation in the header", async () => {
      await renderPage(AutomationsSettingsPage);
      expect(jobsTab.props).toMatchObject({
        variant: "settings",
        canManageOrg: false,
        organizationId: "org-1",
        organizationName: "Builder.io",
      });
      expect(header?.action).toBeTruthy();
    });

    it("lets owners and admins manage every organization automation", async () => {
      orgState.value = { orgId: "org-1", orgName: "Builder.io", role: "admin" };
      await renderPage(AutomationsSettingsPage, {
        context: pageContext({ role: "admin", isAdmin: true }),
      });
      expect(jobsTab.props?.canManageOrg).toBe(true);
    });
  });

  describe("MCP server", () => {
    it("names the app in the about line and links Integrations", async () => {
      await renderPage(McpServerSettingsPage);
      expect(container.textContent).toContain(
        "Connect Clips to Claude, ChatGPT, Cursor, or any AI app that supports MCP.",
      );
      const mcp = container.querySelector('[data-testid="mcp"]');
      expect(mcp?.getAttribute("data-app")).toBe("Clips");
      expect(mcp?.getAttribute("data-hide-header")).toBe("true");
      expect(container.textContent).toContain(
        "For tools the agent itself uses, see Integrations.",
      );
      const link = [...container.querySelectorAll("a")].find(
        (anchor) => anchor.textContent === "Integrations",
      );
      act(() => {
        link?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(navigate).toHaveBeenCalledWith("integrations");
    });

    it("uses the app's own about line when it passes one", async () => {
      await renderPage(McpServerSettingsPage, {
        input: { mcpAbout: "Find recordings from any MCP app." },
      });
      expect(container.textContent).toContain(
        "Find recordings from any MCP app.",
      );
    });
  });

  describe("What's new", () => {
    it("renders the changelog without a second title and names the app in the header", async () => {
      await renderPage(WhatsNewSettingsPage, {
        input: {
          whatsNew: (
            <div>
              <FakeCard markdown={"## 2026-09-25\n- Added"} />
            </div>
          ),
        },
      });
      expect(changelogCard.props).toMatchObject({
        markdown: "## 2026-09-25\n- Added",
        hideTitle: true,
      });
      expect(header?.badge).toBeTruthy();
    });

    it("shows an empty state instead of a blank page when no entries parse", async () => {
      changelogCard.props = null;
      await renderPage(WhatsNewSettingsPage, {
        input: {
          whatsNew: (
            <div>
              <FakeCard markdown={"# Changelog"} />
            </div>
          ),
        },
      });
      expect(changelogCard.props).toBeNull();
      expect(container.querySelector('[data-slot="empty"]')?.textContent).toBe(
        "No updates yet.",
      );
    });
  });
});

function FakeCard(_props: { markdown: string }) {
  return null;
}
