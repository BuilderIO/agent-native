// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

const mocks = vi.hoisted(() => ({
  surfaceProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  readClientAppState: vi.fn(async () => null),
  setClientAppState: vi.fn(async () => null),
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: (props: Record<string, unknown>) => {
    mocks.surfaceProps.push(props);
    return (
      <div data-testid="mock-home-chat">
        {props.composerToolbarSlot as ReactNode}
      </div>
    );
  },
  AgentChatSurface: (props: Record<string, unknown>) => {
    mocks.surfaceProps.push(props);
    return (
      <div data-testid="mock-surface-chat">
        {props.composerContextBannerSlot as ReactNode}
        {props.composerToolbarSlot as ReactNode}
      </div>
    );
  },
}));

import { WorkspaceAgent } from "./WorkspaceAgent";

describe("WorkspaceAgent approval mode and context banner", () => {
  afterEach(() => {
    mocks.surfaceProps.length = 0;
    sessionStorage.clear();
  });

  it("renders approval mode descriptions and updates mode on selection in home mode", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient();
    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <AgentNativeI18nProvider
              catalog={{ messages: enUS }}
              persistPreference={false}
            >
              <MemoryRouter initialEntries={["/home"]}>
                <WorkspaceAgent mode="home" orgId="org-1" />
              </MemoryRouter>
            </AgentNativeI18nProvider>
          </QueryClientProvider>,
        );
      });

      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Approval mode: Ask"]',
      );
      expect(trigger).not.toBeNull();
      expect(trigger?.textContent).toContain("Ask");

      await act(async () => {
        trigger?.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
        );
        trigger?.click();
      });

      const menuText = document.body.textContent ?? "";
      expect(menuText).toContain("Ask for approval");
      expect(menuText).toContain("Ask before taking destructive actions.");
      expect(menuText).toContain("Skip approvals");
      expect(menuText).toContain(
        "Only ask for permission grants that expand access.",
      );

      const skipItem = [...document.querySelectorAll('[role="menuitem"]')].find(
        (el) => el.textContent?.includes("Skip approvals"),
      );
      expect(skipItem).toBeDefined();
      await act(async () => {
        (skipItem as HTMLElement).click();
      });

      const updatedTrigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Approval mode: Skip"]',
      );
      expect(updatedTrigger).not.toBeNull();
      expect(updatedTrigger?.textContent).toContain("Skip");
    } finally {
      await act(async () => root.unmount());
      client.clear();
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("preserves tool labels, details, and approval mode toolbar in existing thread mode", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient();
    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <AgentNativeI18nProvider
              catalog={{ messages: enUS }}
              persistPreference={false}
            >
              <MemoryRouter initialEntries={["/thread/existing-thread-1"]}>
                <WorkspaceAgent
                  mode="thread"
                  orgId="org-1"
                  threadId="existing-thread-1"
                />
              </MemoryRouter>
            </AgentNativeI18nProvider>
          </QueryClientProvider>,
        );
      });

      const lastProps = mocks.surfaceProps.at(-1);
      expect(lastProps).toBeDefined();
      expect(typeof lastProps?.resolveToolStepLabel).toBe("function");
      expect(typeof lastProps?.renderToolStepDetails).toBe("function");
      expect(typeof lastProps?.formatWorkedForDuration).toBe("function");
      expect(lastProps?.queuedComposerPlaceholder).toBe(
        enUS.analytics.ask.queuedPlaceholder,
      );
      expect(lastProps?.stopButtonLabel).toBe(enUS.analytics.ask.stop);
      expect(lastProps?.workingLabel).toBe(enUS.analytics.ask.working);
      expect(
        host.querySelector('button[aria-label="Approval mode: Ask"]'),
      ).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      client.clear();
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("allows dismissing the notebook context banner and persists dismissal in sessionStorage", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient();
    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <AgentNativeI18nProvider
              catalog={{ messages: enUS }}
              persistPreference={false}
            >
              <MemoryRouter initialEntries={["/project/p1"]}>
                <WorkspaceAgent mode="notebook" orgId="org-1" projectId="p1" />
              </MemoryRouter>
            </AgentNativeI18nProvider>
          </QueryClientProvider>,
        );
      });

      expect(host.textContent).toContain("Get better answers in < 5 minutes");
      const dismissBtn = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Hide context message"]',
      );
      expect(dismissBtn).not.toBeNull();
      await act(async () => {
        dismissBtn?.click();
      });

      expect(host.textContent).not.toContain(
        "Get better answers in < 5 minutes",
      );
      expect(sessionStorage.getItem("ws-agent-notebook-tip-dismissed")).toBe(
        "1",
      );
    } finally {
      await act(async () => root.unmount());
      client.clear();
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
