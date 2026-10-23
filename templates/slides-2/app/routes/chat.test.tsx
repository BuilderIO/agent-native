// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const { chatSurfaceMock, agentPanelMock } = vi.hoisted(() => ({
  chatSurfaceMock: vi.fn(),
  agentPanelMock: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  fetchAgentEngineConfiguredState: async () => "unavailable",
  useAgentEngineConfigured: () => ({
    canChat: false,
    missing: false,
    state: "unknown",
  }),
  useChatModels: () => ({
    availableModels: [],
    configuredModels: [],
    defaultModel: "",
    selectedModel: "",
    selectedEngine: "",
    selectedEffort: "medium",
    isLoading: false,
    selectionReady: false,
    unavailableSelection: null,
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    refreshEngines: vi.fn(),
  }),
  markAgentChatHomeHandoff: vi.fn(),
}));
vi.mock("@agent-native/toolkit/app/chat", async (importOriginal) => {
  const toolkit =
    await importOriginal<typeof import("@agent-native/toolkit/app/chat")>();
  return {
    ...toolkit,
    AgentChatSurface: (props: Record<string, unknown>) => {
      chatSurfaceMock(props);
      const surface = toolkit.AgentChatSurface(
        props as Parameters<typeof toolkit.AgentChatSurface>[0],
      );
      const panel = (surface.props as { children: unknown[] }).children[1];
      if (panel && typeof panel === "object" && "type" in panel) {
        agentPanelMock(panel);
      }
      return null;
    },
  };
});
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, values?: Record<string, unknown>) =>
    key === "agent.slideNumber" ? `Slide ${values?.number}` : key,
}));
vi.mock("@/lib/tab-id", () => ({ TAB_ID: "slides-test" }));
vi.mock("@/components/editor/SlidesComposerContextProvider", () => ({
  SlidesComposerContextProvider: () => null,
}));

// source-read-ok: keeps the route's rich chat renderer bootstrap wired at app startup.
const appRootSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../root.tsx"),
  "utf8",
);

import { AgentPanel } from "@agent-native/toolkit/app/chat";

import { SlidesComposerContextProvider } from "@/components/editor/SlidesComposerContextProvider";
import { publishSlidesSelection } from "@/lib/slide-agent-context";

import ChatRoute from "./chat";

function NavigateToSecondSlideChat() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() =>
        navigate("/chat?deckId=deck-1&slideId=slide-2&slideNumber=2")
      }
    >
      Open second slide chat
    </button>
  );
}

afterEach(() => {
  cleanup();
  publishSlidesSelection(null);
  chatSurfaceMock.mockClear();
  agentPanelMock.mockClear();
});

describe("Slides chat route", () => {
  it("uses the shared chat composer and result renderers on its full-page surface", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route path="/chat" element={<ChatRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(chatSurfaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "page",
        defaultMode: "chat",
        composerContextProvider: SlidesComposerContextProvider,
      }),
    );
    expect(agentPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AgentPanel,
        props: expect.objectContaining({
          defaultMode: "chat",
          showHeader: false,
          showTabBar: false,
          isFullscreen: true,
          composerContextProvider: expect.any(Function),
        }),
      }),
    );
    expect(appRootSource).toContain('import "@/lib/register-chat-renderers";');
  });

  it("updates the scope label and agent context after slide navigation", () => {
    render(
      <MemoryRouter initialEntries={["/chat?deckId=deck-1"]}>
        <Routes>
          <Route path="/chat" element={<ChatRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(chatSurfaceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({
          label: "agent.thisSlide",
          context: expect.stringContaining(
            "Current slide id is not available.",
          ),
        }),
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

    expect(chatSurfaceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({
          label: "Slide 2",
          context: expect.stringContaining("Current slide id: slide-2."),
        }),
      }),
    );
  });

  it("does not rerender its scope for caret changes within the same target", () => {
    render(
      <MemoryRouter initialEntries={["/chat?deckId=deck-1"]}>
        <Routes>
          <Route path="/chat" element={<ChatRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    const selection = {
      deckId: "deck-1",
      slideId: "slide-1",
      slideNumber: 1,
      items: [{ objectId: "text-1", textPreview: "first" }],
    };
    act(() => publishSlidesSelection(selection));
    const callsAfterTargetSelection = chatSurfaceMock.mock.calls.length;

    act(() =>
      publishSlidesSelection({
        ...selection,
        items: [{ objectId: "text-1", textPreview: "second" }],
      }),
    );

    expect(chatSurfaceMock).toHaveBeenCalledTimes(callsAfterTargetSelection);

    act(() =>
      publishSlidesSelection({
        ...selection,
        items: [{ objectId: "text-2", textPreview: "second" }],
      }),
    );

    expect(chatSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        scope: expect.objectContaining({
          context: expect.stringContaining("Selected element targets: text-2."),
        }),
      }),
    );
  });

  it("uses and preserves an explicitly linked slide scope", () => {
    publishSlidesSelection({
      deckId: "deck-1",
      slideId: "stale-slide",
      slideNumber: 1,
      items: [{ objectId: "stale-selection" }],
    });

    render(
      <MemoryRouter
        initialEntries={[
          "/chat?deckId=deck%2F1&slideId=slide%2F2&slideNumber=2",
        ]}
      >
        <Routes>
          <Route path="/chat" element={<ChatRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    const props = chatSurfaceMock.mock.lastCall?.[0] as {
      scope: { context: string; label: string };
      threadUrlSync: { getPath: (id: string | null) => string };
    };
    expect(props.scope.label).toBe("Slide 2");
    expect(props.scope.context).toContain("Current slide id: slide/2.");
    expect(props.scope.context).not.toContain("stale-selection");
    expect(props.threadUrlSync.getPath("thread/1")).toBe(
      "/chat/thread%2F1?deckId=deck%2F1&slideId=slide%2F2&slideNumber=2",
    );
  });

  it("uses the new route slide scope on the first render after query navigation", () => {
    render(
      <MemoryRouter
        initialEntries={["/chat?deckId=deck-1&slideId=slide-1&slideNumber=1"]}
      >
        <NavigateToSecondSlideChat />
        <Routes>
          <Route path="/chat" element={<ChatRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    const previousCallCount = chatSurfaceMock.mock.calls.length;
    act(() =>
      screen.getByRole("button", { name: "Open second slide chat" }).click(),
    );

    const transitionCalls = chatSurfaceMock.mock.calls.slice(previousCallCount);
    expect(transitionCalls.length).toBeGreaterThan(0);
    for (const [props] of transitionCalls) {
      expect(props).toEqual(
        expect.objectContaining({
          scope: expect.objectContaining({
            label: "Slide 2",
            context: expect.stringContaining("Current slide id: slide-2."),
          }),
        }),
      );
    }
  });
});
