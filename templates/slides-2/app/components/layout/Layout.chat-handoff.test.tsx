// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readAssistantChatComposerDraft,
  writeAssistantChatComposerDraft,
} from "../../../../../packages/core/src/client/chat/composer-draft";
import {
  useChatThreads,
  type ChatThreadScope,
} from "../../../../../packages/core/src/client/use-chat-threads";

interface SurfaceProps {
  children?: ReactNode;
  storageKey?: string;
  scope?: ChatThreadScope | null;
  browserTabId?: string;
  onFullscreenRequest?: (threadId?: string) => void;
  threadUrlSync?: {
    routeThreadId: string | null;
    getPath: (id: string | null) => string;
    navigate: (path: string) => void;
  };
}

// Exercise app wiring against Core's actual thread persistence, without a
// model transport or rendering the unrelated shared chat controls.
function ThreadProbe(props: SurfaceProps) {
  const chat = useChatThreads("/test-chat", props.storageKey, props.scope, {
    browserTabId: props.browserTabId,
    routeThreadId: props.threadUrlSync?.routeThreadId,
  });
  const location = useLocation();
  return (
    <>
      <output data-testid="thread">{chat.activeThreadId}</output>
      <output data-testid="route">{location.pathname + location.search}</output>
      <output data-testid="draft">
        {readAssistantChatComposerDraft(chat.activeThreadId)}
      </output>
      {props.onFullscreenRequest ? (
        <button
          onClick={() =>
            props.onFullscreenRequest?.(chat.activeThreadId ?? undefined)
          }
        >
          Fullscreen
        </button>
      ) : (
        <button
          onClick={() => {
            chat.switchThread("thread-b");
            props.threadUrlSync?.navigate(
              props.threadUrlSync.getPath("thread-b"),
            );
          }}
        >
          Switch thread
        </button>
      )}
      {props.children}
    </>
  );
}

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  fetchAgentEngineConfiguredState: async () => "unavailable",
  isAgentChatHomeHandoffActive: () => false,
  markAgentChatHomeHandoff: vi.fn(),
  useAgentChatHomeHandoff: () => false,
  useAgentChatHomeHandoffLinks: vi.fn(),
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
  navigateWithAgentChatViewTransition: (
    navigate: (path: string) => void,
    path: string,
  ) => navigate(path),
}));
vi.mock("@agent-native/toolkit/app/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/toolkit/app/chat")>()),
  AgentSidebar: (props: SurfaceProps) => <ThreadProbe {...props} />,
  AgentChatSurface: (props: SurfaceProps) => <ThreadProbe {...props} />,
  focusAgentChat: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/toolkit/app/org")>()),
  InvitationBanner: () => null,
}));
vi.mock("@agent-native/creative-context/client", () => ({
  useCreativeContextLab: () => false,
  CreativeContextComposerChip: () => null,
}));
vi.mock("@agent-native/toolkit/app-shell", () => ({
  HeaderActionsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/context/DeckContext", () => ({
  useDecks: () => ({ flushDeckSave: vi.fn() }),
}));
vi.mock("@/hooks/use-settings-redesign", () => ({
  useSettingsRedesign: () => ({ status: "ready", enabled: false }),
}));
vi.mock("@/hooks/use-sidebar-collapsed", () => ({
  useSidebarCollapsed: () => ({ collapsed: false, setCollapsed: vi.fn() }),
}));
vi.mock("@/lib/tab-id", () => ({ TAB_ID: "slides-test" }));
vi.mock("../editor/GoogleDriveConnectionCta", () => ({
  GoogleDriveConnectionCta: () => null,
}));
vi.mock("../editor/SlidesComposerContextProvider", () => ({
  SlidesComposerContextProvider: () => null,
}));
vi.mock("./AgentWorkIndicator", () => ({ AgentWorkIndicator: () => null }));
vi.mock("./Header", () => ({ Header: () => null }));
vi.mock("./Sidebar", () => ({ Sidebar: () => null }));

import ChatRoute from "@/routes/chat";

import { Layout } from "./Layout";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Slides chat handoff", () => {
  it.each([
    {
      path: "/deck/deck-1",
      scope: { type: "deck", id: "deck-1" },
      query: "?deckId=deck-1",
    },
    { path: "/templates", scope: null, query: "" },
  ])(
    "preserves the active thread and drafts in both directions from $path",
    async ({ path, scope, query }) => {
      const scopePart = scope ? `:scope:${scope.type}:${scope.id}` : "";
      const activeKey = `agent-chat-active-thread${scopePart}:tab:slides-test`;
      window.localStorage.setItem(activeKey, "thread-a");
      writeAssistantChatComposerDraft("thread-a", "Keep my unsent prompt");
      writeAssistantChatComposerDraft("thread-b", "Continue this draft");
      const uuid = vi.fn(() => "unexpected-new-thread");
      vi.stubGlobal("crypto", { randomUUID: uuid });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url !== "/test-chat/threads")
            throw new Error(`Unexpected fetch: ${url}`);
          return new Response(
            JSON.stringify({
              threads: ["thread-a", "thread-b"].map((id) => ({
                id,
                title: id,
                preview: "",
                messageCount: 2,
                createdAt: 1,
                updatedAt: 2,
                scope,
              })),
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }),
      );
      render(
        <MemoryRouter initialEntries={[path]}>
          <Layout>
            <Routes>
              <Route path="/chat/:threadId" element={<ChatRoute />} />
              <Route path="*" element={<div>App</div>} />
            </Routes>
            <Link to={path}>Return to app</Link>
          </Layout>
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("thread").textContent).toBe("thread-a"),
      );
      expect(screen.getByTestId("draft").textContent).toBe(
        "Keep my unsent prompt",
      );
      act(() => screen.getByRole("button", { name: "Fullscreen" }).click());
      await waitFor(() =>
        expect(screen.getByTestId("route").textContent).toBe(
          `/chat/thread-a${query}`,
        ),
      );
      expect(screen.getByTestId("thread").textContent).toBe("thread-a");
      expect(screen.getByTestId("draft").textContent).toBe(
        "Keep my unsent prompt",
      );
      act(() => screen.getByRole("button", { name: "Switch thread" }).click());
      await waitFor(() =>
        expect(screen.getByTestId("route").textContent).toBe(
          `/chat/thread-b${query}`,
        ),
      );
      act(() => screen.getByRole("link", { name: "Return to app" }).click());
      await waitFor(() =>
        expect(screen.getByTestId("thread").textContent).toBe("thread-b"),
      );
      expect(screen.getByTestId("draft").textContent).toBe(
        "Continue this draft",
      );
      expect(window.localStorage.getItem(activeKey)).toBe("thread-b");
      expect(readAssistantChatComposerDraft("thread-a")).toBe(
        "Keep my unsent prompt",
      );
      expect(uuid).not.toHaveBeenCalled();
    },
  );
});
