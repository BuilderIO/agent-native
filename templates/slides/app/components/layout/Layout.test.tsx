// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  agentSidebarMock,
  flushDeckSaveMock,
  useDecksMock,
  creativeContextLabEnabled,
} = vi.hoisted(() => ({
  agentSidebarMock: vi.fn(),
  flushDeckSaveMock: vi.fn(),
  useDecksMock: vi.fn(),
  creativeContextLabEnabled: { value: false },
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  AgentSidebar: ({
    children,
    ...props
  }: {
    children: ReactNode;
    composerSlot?: ReactNode;
    [key: string]: unknown;
  }) => {
    agentSidebarMock(props);
    return (
      <div data-testid="agent-sidebar">
        {props.composerSlot}
        {children}
      </div>
    );
  },
  focusAgentChat: vi.fn(),
  isAgentChatHomeHandoffActive: vi.fn(() => false),
  navigateWithAgentChatViewTransition: vi.fn(),
  useAgentChatHomeHandoff: vi.fn(() => false),
  useAgentChatHomeHandoffLinks: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    key === "agent.slideNumber" ? `Slide ${values?.number}` : key,
}));
vi.mock("@agent-native/core/client/org", () => ({
  InvitationBanner: () => <div data-testid="invitation-banner" />,
}));
vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextComposerChip: () => (
    <div data-testid="creative-context-composer-chip" />
  ),
  useCreativeContextLab: () => creativeContextLabEnabled.value,
}));
vi.mock("@agent-native/toolkit/app-shell", () => ({
  HeaderActionsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@shared/google-docs", () => ({
  extractGoogleSlidesUrls: () => [],
}));
vi.mock("@tabler/icons-react", () => ({
  IconMenu2: () => <span data-testid="menu-icon" />,
}));
vi.mock("@/context/DeckContext", () => ({ useDecks: useDecksMock }));
vi.mock("@/hooks/use-sidebar-collapsed", () => ({
  useSidebarCollapsed: () => ({ collapsed: false, setCollapsed: vi.fn() }),
}));
vi.mock("@/lib/tab-id", () => ({ TAB_ID: "slides-test" }));
vi.mock("@/lib/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
vi.mock("../editor/GoogleDriveConnectionCta", () => ({
  GoogleDriveConnectionCta: () => null,
}));
vi.mock("./AgentWorkIndicator", () => ({
  AgentWorkIndicator: () => <div data-testid="agent-work-indicator" />,
}));
vi.mock("./Header", () => ({ Header: () => <div data-testid="header" /> }));
vi.mock("./Sidebar", () => ({
  Sidebar: () => <aside data-testid="app-sidebar" />,
}));

import { publishSlidesSelection } from "@/lib/slide-agent-context";

import { Layout } from "./Layout";

afterEach(() => {
  cleanup();
  publishSlidesSelection(null);
  Reflect.deleteProperty(window, "ReactNativeWebView");
});

function renderLayout(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Layout>
        <div data-testid="page-content">Content</div>
      </Layout>
      <NavigateAway />
    </MemoryRouter>,
  );
}

function NavigateAway() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/")}>
      Navigate away
    </button>
  );
}

describe("Slides Layout", () => {
  beforeEach(() => {
    agentSidebarMock.mockClear();
    flushDeckSaveMock.mockReset().mockResolvedValue(undefined);
    useDecksMock.mockReturnValue({
      decks: [],
      loading: false,
      flushDeckSave: flushDeckSaveMock,
    });
    creativeContextLabEnabled.value = false;
  });

  it("hides the Creative Context composer chip until its lab is enabled", () => {
    const offRender = renderLayout("/");
    expect(screen.queryByTestId("creative-context-composer-chip")).toBeNull();
    offRender.unmount();

    creativeContextLabEnabled.value = true;
    renderLayout("/");
    expect(screen.getByTestId("creative-context-composer-chip")).toBeTruthy();
  });

  it("enables agent-panel auto-open only during a run", () => {
    renderLayout("/");

    expect(agentSidebarMock).toHaveBeenCalledWith(
      expect.objectContaining({ openOnChatRunning: false }),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "chat-a" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "chat-b" },
        }),
      );
    });
    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ openOnChatRunning: true }),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "chat-a" },
        }),
      );
    });
    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ openOnChatRunning: true }),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "chat-b" },
        }),
      );
    });
    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ openOnChatRunning: false }),
    );
  });

  it("clears running tabs when leaving full-page chat", () => {
    renderLayout("/chat");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "chat-a" },
        }),
      );
    });

    act(() => {
      screen.getByRole("button", { name: "Navigate away" }).click();
    });

    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ openOnChatRunning: false }),
    );
  });

  it("keeps the app shell visible on the empty root route", () => {
    renderLayout("/");

    expect(screen.getByTestId("app-sidebar")).toBeTruthy();
    expect(screen.getByTestId("header")).toBeTruthy();
    expect(screen.getByTestId("invitation-banner")).toBeTruthy();
    expect(screen.getByTestId("agent-work-indicator")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "sidebar.openNavigation" }),
    ).toBeTruthy();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });

  it("preserves the deck route toolbar boundary", () => {
    renderLayout("/deck/deck-1");

    expect(screen.queryByTestId("app-sidebar")).toBeNull();
    expect(screen.queryByTestId("header")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "sidebar.openNavigation" }),
    ).toBeNull();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });

  it("acknowledges a mobile flush only after the matching deck is saved", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "ReactNativeWebView", {
      configurable: true,
      value: { postMessage },
    });
    renderLayout("/deck/deck-1");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.mobileDeckSaveFlush", {
          detail: { requestId: "request-1", deckId: "deck-1" },
        }),
      );
    });

    await waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
    expect(flushDeckSaveMock).toHaveBeenCalledWith("deck-1");
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({
      type: "agentNative.mobileDeckSaveFlush.ack",
      requestId: "request-1",
      requestedDeckId: "deck-1",
      activeDeckId: "deck-1",
      status: "flushed",
    });
  });

  it("reports nonmatching Slides routes without flushing another deck", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "ReactNativeWebView", {
      configurable: true,
      value: { postMessage },
    });
    renderLayout("/deck/deck-2");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.mobileDeckSaveFlush", {
          detail: { requestId: "request-2", deckId: "deck-1" },
        }),
      );
    });

    expect(postMessage).toHaveBeenCalledOnce();
    expect(flushDeckSaveMock).not.toHaveBeenCalled();
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({
      type: "agentNative.mobileDeckSaveFlush.ack",
      requestId: "request-2",
      requestedDeckId: "deck-1",
      activeDeckId: "deck-2",
      status: "not-target",
    });
  });

  it("never acknowledges a failed deck save as flushed", async () => {
    flushDeckSaveMock.mockRejectedValueOnce(new Error("save failed"));
    const postMessage = vi.fn();
    Object.defineProperty(window, "ReactNativeWebView", {
      configurable: true,
      value: { postMessage },
    });
    renderLayout("/deck/deck-1");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.mobileDeckSaveFlush", {
          detail: { requestId: "request-3", deckId: "deck-1" },
        }),
      );
    });

    await waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
    expect(JSON.parse(postMessage.mock.calls[0][0])).toMatchObject({
      requestedDeckId: "deck-1",
      activeDeckId: "deck-1",
      status: "failed",
    });
  });

  it("updates the agent scope label as the current slide changes", () => {
    renderLayout("/deck/deck-1");

    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dynamicSuggestions: false,
        scope: expect.objectContaining({ label: "agent.thisSlide" }),
      }),
    );

    act(() => {
      publishSlidesSelection({
        deckId: "deck-1",
        slideId: "slide-2",
        slideIndex: 1,
        slideNumber: 2,
        items: [],
      });
    });
    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ label: "Slide 2" }),
      }),
    );

    act(() => {
      publishSlidesSelection({
        deckId: "deck-1",
        slideId: "slide-5",
        slideIndex: 4,
        slideNumber: 5,
        items: [],
      });
    });
    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ label: "Slide 5" }),
      }),
    );
  });

  it("renders full-page chat without the sidebar wrapper", () => {
    renderLayout("/chat");

    expect(screen.queryByTestId("agent-sidebar")).toBeNull();
    expect(screen.queryByTestId("agent-work-indicator")).toBeNull();
    expect(screen.getByTestId("app-sidebar")).toBeTruthy();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });
});
