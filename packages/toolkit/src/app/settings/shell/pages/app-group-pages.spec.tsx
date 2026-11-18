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
  return { useT: () => t, useLocale: () => ({ locale: "en-US" }) };
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
  query: { data: undefined as LabStates | undefined, updatedAt: 0 },
  isError: false,
  isPending: false,
  mutate: vi.fn(),
  refetch: vi.fn(),
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
    dataUpdatedAt: labsActions.query.updatedAt,
    isLoading: labsActions.query.data === undefined && !labsActions.isError,
    isError: labsActions.isError,
    refetch: labsActions.refetch,
  }),
  useActionMutation: () => ({
    mutate: labsActions.mutate,
    isPending: labsActions.isPending,
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
vi.mock("../../../resources/McpAccessSettings.js", () => ({
  McpHostMark: () => <span />,
  McpAccessSettings: ({
    appName,
    hideHeader,
    helpText,
    guideId,
    onSelectGuide,
    guideHref,
  }: {
    appName: string;
    hideHeader: boolean;
    helpText?: string;
    guideId?: string | null;
    onSelectGuide: (id: string) => void;
    guideHref: (id: string) => string;
  }) => (
    <div
      data-testid="mcp"
      data-app={appName}
      data-hide-header={hideHeader}
      data-help={helpText}
      data-guide={guideId}
      data-cursor-href={guideHref("cursor")}
    >
      <button onClick={() => onSelectGuide("cursor")}>Choose Cursor</button>
    </div>
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
    labsActions.query.updatedAt = 0;
    labsActions.isError = false;
    labsActions.isPending = false;
    labsActions.refetch.mockReset();
    labsActions.refetch.mockResolvedValue({ isSuccess: true });
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

    /** Ends a save the way set-lab does, with the states it applies. */
    function answer(options: unknown, states: LabStates) {
      (
        options as { onSuccess?: (result: { states: LabStates }) => void }
      ).onSuccess?.({ states });
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

    it("turns on every lab from the Show all Labs features switch", async () => {
      labsActions.query.data = {
        "clips.wisprflow": { enabled: true, source: "default", mixed: false },
        "clips.meetings": { enabled: false, source: "default", mixed: false },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });
      const showAll = switchFor("Show all Labs features");
      expect(showAll?.disabled).toBe(false);
      act(() => showAll?.click());
      expect(labsActions.mutate).toHaveBeenCalledWith(
        { enabled: true },
        expect.any(Object),
      );
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

    it("offers an explicit choice to repair an unreadable saved lab", async () => {
      labsActions.query.data = {
        "clips.wisprflow": { error: "invalid-choice" },
        "clips.meetings": {
          enabled: false,
          source: "default",
          mixed: false,
        },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });

      expect(container.textContent).toContain(
        "Couldn't read this saved choice.",
      );
      const on = container.querySelector<HTMLButtonElement>(
        '[aria-label="Voice dictation: On"]',
      );
      expect(on?.disabled).toBe(false);
      act(() => on?.click());
      expect(labsActions.mutate).toHaveBeenCalledWith(
        { key: "clips.wisprflow", enabled: true },
        expect.any(Object),
      );
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
            answer(options, {
              "chatgpt-subscription": {
                enabled,
                source: "choice",
                mixed: false,
              },
            });
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

    it("shows a lab the host decides as set, and doesn't let it change", async () => {
      labsActions.query.data = {
        "clips.wisprflow": { enabled: false, source: "default", mixed: false },
        "clips.meetings": { enabled: true, source: "host", mixed: false },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });
      const hosted = switchFor("Meetings and transcription");
      expect(hosted?.getAttribute("aria-checked")).toBe("true");
      expect(hosted?.disabled).toBe(true);
      expect(switchFor("Voice dictation")?.disabled).toBe(false);
      expect(container.textContent).toContain(
        "This one is set for you, so it can't be changed here.",
      );
      expect(
        container.querySelector(
          '[aria-label="Meetings and transcription: Use default"]',
        ),
      ).toBeNull();
    });

    it("shows what the server applies once a save answers, not the choice", async () => {
      labsActions.query.data = {
        "clips.meetings": { enabled: false, source: "default", mixed: false },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });
      const toggle = switchFor("Meetings and transcription");
      act(() => toggle?.click());
      expect(toggle?.getAttribute("aria-checked")).toBe("true");

      const [, options] = labsActions.mutate.mock.calls[0] ?? [];
      act(() => {
        answer(options, {
          "clips.meetings": { enabled: false, source: "host", mixed: false },
        });
      });

      expect(
        switchFor("Meetings and transcription")?.getAttribute("aria-checked"),
      ).toBe("false");
      expect(switchFor("Meetings and transcription")?.disabled).toBe(true);
    });

    it("shows a save's answer until a later read lands, even when no read follows it", async () => {
      labsActions.query.data = {
        "clips.meetings": { enabled: false, source: "default", mixed: false },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });
      const toggle = switchFor("Meetings and transcription");
      act(() => toggle?.click());

      const [, options] = labsActions.mutate.mock.calls[0] ?? [];
      act(() => {
        answer(options, {
          "clips.meetings": { enabled: true, source: "choice", mixed: false },
        });
      });
      await renderPage(LabsSettingsPage, { input: { labs } });

      expect(toggle?.getAttribute("aria-checked")).toBe("true");
      expect(
        container.querySelector(
          '[aria-label="Meetings and transcription: Use default"]',
        ),
      ).not.toBeNull();

      // A later read, here after the host took the lab over, replaces it.
      labsActions.query.data = {
        "clips.meetings": { enabled: false, source: "host", mixed: false },
      };
      labsActions.query.updatedAt = 1;
      await renderPage(LabsSettingsPage, { input: { labs } });

      expect(
        switchFor("Meetings and transcription")?.getAttribute("aria-checked"),
      ).toBe("false");
      expect(switchFor("Meetings and transcription")?.disabled).toBe(true);
      expect(
        container.querySelector(
          '[aria-label="Meetings and transcription: Use default"]',
        ),
      ).toBeNull();
    });

    it("clears a saved choice with Use default, and offers it only for a saved choice", async () => {
      labsActions.query.data = {
        "clips.wisprflow": { enabled: false, source: "choice", mixed: false },
        "clips.meetings": { enabled: false, source: "default", mixed: false },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });
      expect(
        container.querySelector(
          '[aria-label="Meetings and transcription: Use default"]',
        ),
      ).toBeNull();
      const reset = container.querySelector<HTMLButtonElement>(
        '[aria-label="Voice dictation: Use default"]',
      );
      expect(reset?.disabled).toBe(false);
      act(() => reset?.click());
      expect(labsActions.mutate).toHaveBeenCalledWith(
        { key: "clips.wisprflow", enabled: null },
        expect.any(Object),
      );
      expect(switchFor("Voice dictation")?.getAttribute("aria-checked")).toBe(
        "false",
      );
    });

    it("shows a cleared lab following its default from the save's answer, with no read after it", async () => {
      labsActions.query.data = {
        "clips.wisprflow": { enabled: true, source: "choice", mixed: false },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });
      const reset = container.querySelector<HTMLButtonElement>(
        '[aria-label="Voice dictation: Use default"]',
      );
      act(() => reset?.click());

      const [, options] = labsActions.mutate.mock.calls[0] ?? [];
      act(() => {
        answer(options, {
          "clips.wisprflow": {
            enabled: false,
            source: "default",
            mixed: false,
          },
        });
      });

      expect(switchFor("Voice dictation")?.getAttribute("aria-checked")).toBe(
        "false",
      );
      expect(
        container.querySelector('[aria-label="Voice dictation: Use default"]'),
      ).toBeNull();
    });

    it("reads the labs again when a save fails, so the row shows what was saved", async () => {
      labsActions.query.data = {
        "clips.wisprflow": { enabled: true, source: "choice", mixed: false },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });
      const reset = container.querySelector<HTMLButtonElement>(
        '[aria-label="Voice dictation: Use default"]',
      );
      act(() => reset?.click());
      expect(labsActions.refetch).not.toHaveBeenCalled();

      const [, options] = labsActions.mutate.mock.calls[0] ?? [];
      act(() => {
        (options as { onError?: () => void } | undefined)?.onError?.();
      });

      expect(labsActions.refetch).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });

    it("puts focus on an unreadable row's first button when its save fails", async () => {
      labsActions.query.data = {
        "clips.wisprflow": { error: "invalid-choice" },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });
      const on = container.querySelector<HTMLButtonElement>(
        '[aria-label="Voice dictation: On"]',
      );
      on?.focus();
      act(() => on?.click());
      // A browser drops focus from a control the save disables.
      on?.blur();

      labsActions.isPending = true;
      await renderPage(LabsSettingsPage, { input: { labs } });
      const [, options] = labsActions.mutate.mock.calls[0] ?? [];
      act(() => {
        (options as { onError?: () => void } | undefined)?.onError?.();
      });
      labsActions.isPending = false;
      await renderPage(LabsSettingsPage, { input: { labs } });

      expect(switchFor("Voice dictation")).toBeNull();
      expect(document.activeElement).toBe(
        container.querySelector('[aria-label="Voice dictation: On"]'),
      );
    });

    it("puts focus back on the row's switch once Use default is saved", async () => {
      labsActions.query.data = {
        "clips.wisprflow": { enabled: true, source: "choice", mixed: false },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });
      const reset = container.querySelector<HTMLButtonElement>(
        '[aria-label="Voice dictation: Use default"]',
      );
      reset?.focus();
      act(() => reset?.click());

      // The save disables the row's controls, which takes focus off them.
      labsActions.isPending = true;
      await renderPage(LabsSettingsPage, { input: { labs } });
      reset?.blur();
      labsActions.isPending = false;
      await renderPage(LabsSettingsPage, { input: { labs } });
      expect(document.activeElement).toBe(switchFor("Voice dictation"));

      // Then the read-back shows the default, and Use default goes away.
      labsActions.query.data = {
        "clips.wisprflow": { enabled: false, source: "default", mixed: false },
      };
      await renderPage(LabsSettingsPage, { input: { labs } });
      expect(
        container.querySelector('[aria-label="Voice dictation: Use default"]'),
      ).toBeNull();
      expect(document.activeElement).toBe(switchFor("Voice dictation"));
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
    it("routes client choices through the Settings shell", async () => {
      await renderPage(McpServerSettingsPage);
      const mcp = container.querySelector('[data-testid="mcp"]');
      expect(mcp?.getAttribute("data-app")).toBe("Clips");
      expect(mcp?.getAttribute("data-hide-header")).toBe("true");
      expect(mcp?.getAttribute("data-cursor-href")).toBe(
        "/settings/mcp/cursor",
      );
      expect(mcp?.getAttribute("data-guide")).toBeNull();
      expect(header).toBeNull();
      act(() => container.querySelector<HTMLButtonElement>("button")?.click());
      expect(navigate).toHaveBeenCalledWith("mcp", "cursor");
    });

    it("uses the app's own about line when it passes one", async () => {
      await renderPage(McpServerSettingsPage, {
        input: { mcpAbout: "Find recordings from any MCP app." },
      });
      expect(
        container.querySelector("[data-testid=mcp]")?.getAttribute("data-help"),
      ).toBe("Find recordings from any MCP app.");
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
