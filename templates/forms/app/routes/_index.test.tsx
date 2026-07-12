// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const agentChatSurfaceMock = vi.hoisted(() => vi.fn());
const cancelPrewarmMock = vi.hoisted(() => vi.fn());
const sendToAgentChatMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client", () => ({
  AgentChatSurface: (props: Record<string, unknown>) => {
    agentChatSurfaceMock(props);
    return (
      <div data-testid="agent-chat-surface">
        {props.composerSlot as React.ReactNode}
      </div>
    );
  },
  markAgentChatHomeHandoff: vi.fn(),
  sendToAgentChat: sendToAgentChatMock,
  useT: () => (key: string) => {
    const strings: Record<string, string> = {
      "home.composerPlaceholder": "What do you want to do?",
      "home.description": "Build, publish, and analyze forms with an agent.",
      "home.heading": "What should this form do?",
      "home.pillAnalytics": "Analytics",
      "home.pillConfiguration": "Configuration",
      "home.pillForms": "Forms",
    };
    return strings[key] ?? key;
  },
}));

vi.mock("@/lib/route-prewarm", () => ({
  scheduleFormsRoutePrewarm: () => cancelPrewarmMock,
}));

import { AskPage } from "../pages/AskPage.js";

describe("Forms ask page", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    vi.clearAllMocks();
  });

  it("keeps the main Ask tab wired to the shared Forms thread state", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(<AskPage />);
    });

    expect(agentChatSurfaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "page",
        storageKey: "forms",
        showHeader: false,
        showTabBar: false,
      }),
    );
    expect(agentChatSurfaceMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "restoreActiveThread",
      false,
    );
    expect(container.textContent).toContain("What should this form do?");
  });

  it("prefills the shared composer when a suggestion chip is clicked", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(<AskPage />);
    });

    const analyticsChip = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Analytics"),
    );
    expect(analyticsChip).toBeDefined();

    act(() => {
      analyticsChip?.click();
    });

    expect(sendToAgentChatMock).toHaveBeenCalledWith({
      message: "analytics",
      submit: false,
      chatTarget: "local",
    });
  });
});
