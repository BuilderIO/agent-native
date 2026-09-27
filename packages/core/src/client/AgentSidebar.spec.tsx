// @vitest-environment happy-dom

import React, { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockHostedHarness = vi.hoisted(() => ({
  configured: false,
  enabled: false,
}));

vi.mock("./AgentSidebarPanel.js", () => ({
  AgentSidebarPanel: () => <div data-agent-sidebar-panel-loaded="true" />,
}));
vi.mock("./agent-chat.js", () => ({}));
vi.mock("./mcp-app-host.js", () => ({}));
vi.mock("./agent-sidebar-url-sync.js", () => ({
  ScreenRefreshBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  URLSync: () => <div data-testid="agent-sidebar-url-sync" />,
}));
vi.mock("./app-chat-sidebar.js", () => ({
  APP_CHAT_SIDEBAR_STATE_EVENT: "app-chat-sidebar-state",
  APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE: "app-chat-sidebar-state-request",
  buildAppChatSidebarStateMessage: (open: boolean) => ({
    data: { open },
  }),
  isPerAppChatStorageKey: () => false,
  requestPerAppChatCommand: vi.fn(),
  usePerAppChatState: () => ({ hosted: false, open: false }),
}));
vi.mock("./app-config.js", () => ({
  injectedAgentNativeConfig: () => ({
    harness: mockHostedHarness.configured ? {} : undefined,
  }),
}));
vi.mock("./builder-frame.js", () => ({
  shouldParentFrameOwnAgentPanel: () => false,
}));
vi.mock("./chat-view-transition.js", () => ({
  AGENT_CHAT_VIEW_TRANSITION_CLASS: "",
  getAgentChatViewTransitionStyle: (style: React.CSSProperties) => style,
  startAgentChatViewTransition: () => undefined,
}));
vi.mock("./frame.js", () => ({
  getFramePostMessageTargetOrigin: () => null,
  isTrustedFrameMessage: () => true,
}));
vi.mock("./i18n.js", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("./onboarding/first-run-enabled.js", () => ({
  isFirstRunOnboardingEnabled: () => false,
}));
vi.mock("./onboarding/first-run-startup-gate.js", () => ({
  useFirstRunOnboardingGateOwnsSurface: () => false,
}));
vi.mock("./onboarding/use-preview-mode.js", () => ({
  useOnboardingPreviewMode: () => false,
}));
vi.mock("./use-action.js", () => ({
  useActionQuery: (action: string) => ({
    data:
      action === "get-hosted-harness-config" && mockHostedHarness.enabled
        ? { enabled: true, runtimes: [] }
        : undefined,
  }),
}));
vi.mock("./use-db-sync.js", () => ({
  useScreenRefreshKey: () => 0,
}));

import { AgentSidebar } from "./AgentSidebar.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderSidebar(
  defaultOpen: boolean,
  position?: "left" | "right",
  disableChatShortcut = false,
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => {
    root?.render(
      <MemoryRouter>
        <AgentSidebar
          defaultOpen={defaultOpen}
          disableChatShortcut={disableChatShortcut}
          position={position}
        >
          <div data-testid="app-content">App content</div>
        </AgentSidebar>
      </MemoryRouter>,
    );
  });
}

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = undefined;
  container = undefined;
});

beforeEach(() => {
  mockHostedHarness.configured = false;
  mockHostedHarness.enabled = false;
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

describe("AgentSidebar lazy panel boundary", () => {
  it("defaults hosted-harness chat to the right and respects a closed preference", async () => {
    mockHostedHarness.configured = true;
    mockHostedHarness.enabled = true;
    renderSidebar(false);

    await act(async () => {});

    expect(
      container?.querySelector("[data-agent-sidebar-position='right']"),
    ).toBeTruthy();
    expect(
      container?.querySelector("[data-agent-sidebar-main-position='right']"),
    ).toBeTruthy();
    expect(
      container?.querySelector("[data-agent-sidebar-main-state='closed']"),
    ).toBeTruthy();
    expect(
      container
        ?.querySelector(".agent-sidebar-shell")
        ?.getAttribute("data-agent-native-hosted-harness-ui"),
    ).toBe("desktop");
  });

  it("respects an explicit position in hosted-harness UI", async () => {
    mockHostedHarness.configured = true;
    mockHostedHarness.enabled = true;
    renderSidebar(false, "left");

    await act(async () => {});

    expect(
      container?.querySelector("[data-agent-sidebar-position='left']"),
    ).toBeTruthy();
    expect(
      container?.querySelector("[data-agent-sidebar-main-position='left']"),
    ).toBeTruthy();
  });

  it("respects a saved closed state when hosted harness would otherwise open", async () => {
    mockHostedHarness.configured = true;
    mockHostedHarness.enabled = true;
    localStorage.setItem("agent-native-sidebar-open", "false");
    renderSidebar(true);

    await act(async () => {});

    expect(
      container?.querySelector("[data-agent-sidebar-main-state='closed']"),
    ).toBeTruthy();
  });

  it("defers URL synchronization until the panel is mounted", () => {
    renderSidebar(false);

    expect(
      container?.querySelector("[data-testid='agent-sidebar-url-sync']"),
    ).toBeNull();
  });

  it("shows the panel skeleton before the lazy body resolves for open-by-default users", async () => {
    localStorage.setItem("agent-native-sidebar-open", "true");
    renderSidebar(true);

    expect(
      container?.querySelector("[data-testid='app-content']"),
    ).toBeTruthy();
    expect(
      container?.querySelector("[data-agent-sidebar-panel-skeleton='true']"),
    ).toBeTruthy();
    expect(
      container?.querySelector("[data-agent-sidebar-panel-loaded='true']"),
    ).toBeNull();

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container?.querySelector("[data-agent-sidebar-panel-loaded='true']"),
    ).toBeTruthy();
  });

  it("opens from the global shortcut while the panel body is still loading", async () => {
    renderSidebar(false);
    await act(async () => {});

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "\\",
          code: "Backslash",
          metaKey: true,
          bubbles: true,
        }),
      );
    });

    expect(
      container?.querySelector(
        ".agent-sidebar-panel[data-agent-sidebar-state='open']",
      ),
    ).toBeTruthy();

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container?.querySelector("[data-agent-sidebar-panel-loaded='true']"),
    ).toBeTruthy();
  });

  it("leaves Cmd+I available to the app when the chat shortcut is disabled", async () => {
    renderSidebar(false, undefined, true);
    await act(async () => {});

    const onOpen = vi.fn();
    window.addEventListener("agent-panel:open", onOpen);
    const event = new KeyboardEvent("keydown", {
      key: "i",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      document.dispatchEvent(event);
    });

    window.removeEventListener("agent-panel:open", onOpen);
    expect(event.defaultPrevented).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
    expect(
      container?.querySelector("[data-agent-sidebar-main-state='closed']"),
    ).toBeTruthy();
  });
});
