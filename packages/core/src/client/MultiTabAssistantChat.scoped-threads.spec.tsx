// @vitest-environment happy-dom
//
// A chat started while viewing one resource must not surface on another
// resource's page. Regression cover for "Chat of the previously created Design
// was displayed for the new Design": MultiTabAssistantChat passed `scope: null`
// into useChatThreads, so every chat was global and opening a second design
// restored — and typed into — the first design's thread.
//
// Unlike MultiTabAssistantChat.spec.tsx this does NOT mock use-chat-threads:
// the contract under test is how the two are wired together.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetAgentChatContextForTests,
  _resetAgentChatSubmitBufferForTests,
} from "./agent-chat.js";
import {
  MultiTabAssistantChat,
  type MultiTabAssistantChatHeaderProps,
} from "./MultiTabAssistantChat.js";

vi.mock("./frame.js", () => ({
  isTrustedFrameMessage: () => true,
  getFramePostMessageTargetOrigin: () => null,
}));

vi.mock("./builder-frame.js", () => ({
  isInBuilderFrame: () => false,
  isTrustedBuilderMessage: () => false,
  sendToBuilderChat: vi.fn(),
}));

vi.mock("./embed-auth.js", () => ({
  isEmbedAuthActive: () => false,
  isEmbedMcpChatBridgeActive: () => false,
  markEmbedMcpChatBridgeActive: vi.fn(),
  readEmbedMcpChatBridgeFlagFromUrl: () => false,
}));

vi.mock("./mcp-app-host.js", () => ({
  sendMcpAppHostMessage: () => null,
}));

vi.mock("./api-path.js", () => ({
  agentNativePath: (path: string) => path,
}));

vi.mock("./RunStuckBanner.js", () => ({
  RunStuckBanner: () => null,
}));

vi.mock("./components/ui/tooltip.js", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("./components/ui/popover.js", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const sentMessages: Array<{ threadId: string; text: string }> = [];

vi.mock("./AssistantChat.js", async () => {
  const ReactMod = await import("react");
  return {
    AssistantChat: ReactMod.forwardRef(function AssistantChatMock(
      _props: unknown,
      ref,
    ) {
      const props = _props as { threadId?: string };
      ReactMod.useImperativeHandle(ref, () => ({
        sendMessage: (text: string) => {
          sentMessages.push({ threadId: props.threadId ?? "", text });
        },
        prefillMessage: vi.fn(),
        setComposerContextItem: vi.fn(),
        removeComposerContextItem: vi.fn(),
        clearComposerContextItems: vi.fn(),
        sendRecoveryMessage: vi.fn(),
        queueMessage: vi.fn(),
        isRunning: () => false,
        focusComposer: vi.fn(),
        exportThreadSnapshot: () => null,
      }));
      return (
        <div data-testid="assistant-chat" data-thread-id={props.threadId} />
      );
    }),
  };
});

const DESIGN_A = "design-a";
const DESIGN_B = "design-b";
const DESIGN_A_RUN_TAB = "chat-design-a-run";
const DESIGN_B_RUN_TAB = "chat-design-b-run";

// The design editor's chat panel: storageKey "design", per-design scope,
// no tab bar (templates/design/app/pages/DesignEditor.tsx:28982-28996).
function renderPanel(
  root: Root,
  designId: string,
  onHeader: (props: MultiTabAssistantChatHeaderProps) => void,
) {
  return act(async () => {
    root.render(
      <MultiTabAssistantChat
        storageKey="design"
        showTabBar={false}
        scope={{ type: "design", id: designId }}
        renderHeader={(props) => {
          onHeader(props);
          return null;
        }}
      />,
    );
  });
}

function submitGenerationPrompt(tabId: string, message: string) {
  // What useAgentGenerating.submit → sendToDesignAgentChat produces.
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "agentNative.submitChat",
        data: {
          message,
          tabId,
          submit: true,
          newTab: true,
          chatTarget: "local",
          submitMessageId: `submit-${tabId}`,
        },
      },
      origin: window.location.origin,
    }),
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
  // Queued sends are flushed on a 50ms timer once the target tab's ref mounts
  // (MultiTabAssistantChat.tsx:1767).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

describe("MultiTabAssistantChat resource-scoped threads", () => {
  let container: HTMLDivElement;
  let root: Root;
  let header: MultiTabAssistantChatHeaderProps | null = null;

  const scopedActiveThreadKey = (designId: string) =>
    `agent-chat-active-thread:design:scope:design:${designId}`;
  const scopedOpenTabsKey = (designId: string) =>
    `agent-chat-open-tabs:design:scope:design:${designId}`;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const href = String(url);
        if (href.includes("/threads")) return Response.json({ threads: [] });
        return Response.json({ value: null });
      }),
    );
    window.localStorage.clear();
    window.sessionStorage.clear();
    sentMessages.length = 0;
    header = null;
    _resetAgentChatContextForTests();
    _resetAgentChatSubmitBufferForTests();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function mountedThreadId(): string | null {
    return (
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-thread-id") ?? null
    );
  }

  it("does not open a new design on the previous design's generation thread", async () => {
    // ── Design A: generation opens its own chat tab and runs there.
    await renderPanel(root, DESIGN_A, (props) => {
      header = props;
    });
    await settle();

    await act(async () => {
      submitGenerationPrompt(DESIGN_A_RUN_TAB, "Generate design for A");
    });
    await settle();

    expect(header?.activeTabId).toBe(DESIGN_A_RUN_TAB);
    expect(sentMessages).toEqual([
      { threadId: DESIGN_A_RUN_TAB, text: "Generate design for A" },
    ]);
    // The thread is remembered against design A, not globally.
    expect(window.localStorage.getItem(scopedActiveThreadKey(DESIGN_A))).toBe(
      DESIGN_A_RUN_TAB,
    );
    expect(
      window.localStorage.getItem("agent-chat-active-thread:design"),
    ).toBeNull();

    // ── Navigate to the brand-new design B (the editor route remounts its own
    // panel: templates/design/app/components/layout/Layout.tsx:129-143
    // short-circuits before AgentSidebar).
    await act(async () => root.unmount());
    root = createRoot(container);
    header = null;
    await renderPanel(root, DESIGN_B, (props) => {
      header = props;
    });
    await settle();

    expect(header?.activeTabId).not.toBe(DESIGN_A_RUN_TAB);
    expect(mountedThreadId()).not.toBe(DESIGN_A_RUN_TAB);
    expect(header?.tabs.map((tab) => tab.id)).not.toContain(DESIGN_A_RUN_TAB);
    expect(
      JSON.parse(
        window.localStorage.getItem(scopedOpenTabsKey(DESIGN_B)) ?? "[]",
      ),
    ).not.toContain(DESIGN_A_RUN_TAB);

    // Design B's generation lands on design B's own thread.
    await act(async () => {
      submitGenerationPrompt(DESIGN_B_RUN_TAB, "Generate design for B");
    });
    await settle();
    expect(header?.activeTabId).toBe(DESIGN_B_RUN_TAB);
    expect(sentMessages).toEqual([
      { threadId: DESIGN_A_RUN_TAB, text: "Generate design for A" },
      { threadId: DESIGN_B_RUN_TAB, text: "Generate design for B" },
    ]);
  });

  it("restores a design's own thread when the user returns to it", async () => {
    await renderPanel(root, DESIGN_A, (props) => {
      header = props;
    });
    await settle();
    await act(async () => {
      submitGenerationPrompt(DESIGN_A_RUN_TAB, "Generate design for A");
    });
    await settle();

    // Away to another design, then back.
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPanel(root, DESIGN_B, () => {});
    await settle();
    await act(async () => root.unmount());
    root = createRoot(container);
    header = null;
    await renderPanel(root, DESIGN_A, (props) => {
      header = props;
    });
    await settle();

    expect(header?.activeTabId).toBe(DESIGN_A_RUN_TAB);
    expect(mountedThreadId()).toBe(DESIGN_A_RUN_TAB);
  });
});
