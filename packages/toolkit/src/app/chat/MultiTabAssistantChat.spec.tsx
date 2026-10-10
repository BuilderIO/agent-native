// @vitest-environment happy-dom

import { CHATGPT_SUBSCRIPTION_ENGINE_NAME } from "@agent-native/core/agent/chatgpt-subscription-contract";
import {
  AGENT_CHAT_SUBMIT_RESULT_EVENT,
  AGENT_CHAT_CONTEXT_CHANGED_EVENT,
  cancelAgentChatSubmit,
  claimAgentChatOpenRequest,
  claimAgentChatSubmit,
  clearAgentChatContext,
  drainBufferedAgentChatOpenRequests,
  drainBufferedAgentChatSubmits,
  isAgentChatSubmitCancelled,
  listAgentChatContext,
  removeAgentChatContextItem,
  requestAgentChatThreadOpen,
  requestAgentTaskOpen,
  setAgentChatContextItem,
  sendToAgentChat,
} from "@agent-native/core/client/agent-chat";
import { CHAT_MODEL_SELECTION_CHANGED_EVENT } from "@agent-native/core/client/agent-chat";
import { chatModelSelectionStorageKey } from "@agent-native/core/client/agent-chat";
import type {
  ChatThreadScope,
  ChatThreadSummary,
} from "@agent-native/core/client/agent-chat";
import { buildChatModelGroups } from "@agent-native/core/client/chat-model-groups";
import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { invalidateClientStatusRequests } from "@agent-native/core/client/status-requests";
import { ComposerContextError } from "@agent-native/toolkit/composer";
import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_CHAT_INSERT_REFERENCE_EVENT,
  AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE,
  ComposerRuntimeAdaptersProvider,
} from "../../composer/runtime-adapters.js";
import { TiptapComposer } from "../../composer/TiptapComposer.js";
import { TooltipProvider } from "../../ui/tooltip.js";
import { AgentSidebar } from "./AgentSidebar.js";
import { AgentSidebarPanel } from "./AgentSidebarPanel.js";
import {
  MultiTabAssistantChat,
  type MultiTabAssistantChatHeaderProps,
  type MultiTabAssistantChatProps,
} from "./MultiTabAssistantChat.js";

afterEach(() => {
  invalidateClientStatusRequests();
  modelCatalogMocks.load = null;
});

function clearBufferedAgentChatRequests(): void {
  for (const submit of drainBufferedAgentChatSubmits()) {
    if (typeof submit.submitMessageId === "string") {
      claimAgentChatSubmit(submit.submitMessageId);
    }
  }
  for (const request of drainBufferedAgentChatOpenRequests()) {
    claimAgentChatOpenRequest(request.id);
  }
}

function openTabsStorageKey(
  storageKey: string,
  scope?: { type: string; id: string },
): string {
  const scopePart = scope ? `:scope:${scope.type}:${scope.id}` : "";
  return `agent-chat-open-tabs:${storageKey}:tab:${getBrowserTabId()}${scopePart}`;
}

function legacyOpenTabsStorageKey(
  storageKey: string,
  scope?: { type: string; id: string },
): string {
  const scopePart = scope ? `:scope:${scope.type}:${scope.id}` : "";
  return `agent-chat-open-tabs:${storageKey}${scopePart}`;
}

const chatHandleMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(async () => ({ status: "submitted" as const })),
  implementPlan: vi.fn(() => false),
  prefillMessage: vi.fn(),
  setComposerContextItem: vi.fn(),
  canStageComposerContextItem: vi.fn(() => true),
  removeComposerContextItem: vi.fn(),
  clearComposerContextItems: vi.fn(),
  sendRecoveryMessage: vi.fn(),
  queueMessage: vi.fn(),
  focusComposer: vi.fn(),
  exportThreadSnapshot: vi.fn(() => null),
}));

const assistantChatMockState = vi.hoisted(() => ({
  referenceProbe: false,
  referenceDisabled: true,
  deferredHandleThread: null as string | null,
  referenceDeliveries: [] as Array<{ threadId: string; context: string }>,
  onThreadRestoreNotFound: undefined as (() => void) | undefined,
  onRetryModelList: undefined as (() => void) | undefined,
  onSlashCommand: undefined as ((command: string) => void) | undefined,
  onForkedThread: undefined as ((threadId: string) => void) | undefined,
  onGenerateTitle: undefined as
    | ((
        threadId: string,
        message: string,
        selection: { engine?: string; model?: string },
      ) => void)
    | undefined,
  onSaveThread: undefined as
    | ((
        threadId: string,
        data: {
          threadData: string;
          title: string;
          preview: string;
          messageCount: number;
          titleSource?: "fallback";
        },
      ) => void)
    | undefined,
  branchNavigation: undefined as
    | {
        index: number;
        count: number;
        onPrevious: () => void | Promise<void>;
        onNext: () => void | Promise<void>;
      }
    | undefined,
}));

const threadMocks = vi.hoisted(() => ({
  activeThreadId: "thread-1" as string | null,
  isLoading: false,
  evictedThreadIds: [] as string[],
  threads: [
    {
      id: "thread-1",
      title: "Main thread",
      preview: "",
      messageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scope: null,
    },
  ],
  createThread: vi.fn(
    async (requestedId?: string) => requestedId ?? "thread-2",
  ),
  openThread: vi.fn(
    async (): Promise<"opened" | "missing" | "unavailable"> => "opened",
  ),
  switchThread: vi.fn(),
  detachThread: vi.fn(),
  forkThread: vi.fn(),
  saveThreadData: vi.fn(),
  generateTitle: vi.fn(async () => null),
  searchThreads: vi.fn(async () => []),
  refreshThreads: vi.fn(async () => undefined),
  isNewThread: vi.fn(() => false),
  pinThread: vi.fn(async () => true),
  renameThread: vi.fn(async () => true),
}));

const chatThreadHookMocks = vi.hoisted(() => ({
  useChatThreads: vi.fn(),
}));

vi.mock("@agent-native/core/client/host", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/host")>();
  return {
    ...actual,
    getFramePostMessageTargetOrigin: () => null,
    isInBuilderFrame: () => false,
    isTrustedBuilderMessage: () => false,
    isTrustedFrameMessage: () => true,
    sendToBuilderChat: vi.fn(),
  };
});
vi.mock("@agent-native/core/client/mcp-app-host", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/mcp-app-host")
  >()),
  sendMcpAppHostMessage: () => null,
}));
vi.mock("@agent-native/core/client/api-path", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/api-path")>();
  return { ...actual, agentNativePath: (path: string) => path };
});
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/client/agent-chat")
    >();
  return {
    ...actual,
    useChatThreads: chatThreadHookMocks.useChatThreads,
    loadChatModelCatalog: () =>
      modelCatalogMocks.load?.() ?? actual.loadChatModelCatalog(),
  };
});
vi.mock("./RunStuckBanner.js", () => ({
  RunStuckBanner: () => null,
}));

vi.mock("@agent-native/toolkit/ui/tooltip", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/ui/tooltip")
  >()),
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

vi.mock("@agent-native/toolkit/ui/popover", () => ({
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

const ANTHROPIC_ENGINES = [
  {
    name: "anthropic",
    label: "Claude",
    defaultModel: "claude-sonnet-5-5",
    supportedModels: ["claude-sonnet-5"],
    requiredEnvVars: ["ANTHROPIC_API_KEY"],
  },
  {
    name: "ai-sdk:openai",
    label: "OpenAI",
    defaultModel: "gpt-5.6-luna",
    supportedModels: ["gpt-5.6-luna"],
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
];

const actionMocks = vi.hoisted(() => ({ callAction: vi.fn(async () => null) }));
const modelCatalogMocks = vi.hoisted(() => ({
  load: null as null | (() => Promise<unknown>),
}));

vi.mock("@agent-native/core/client/use-action", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/client/use-action")
    >();
  return { ...actual, ...actionMocks };
});

function stubCatalog(
  engines: unknown[],
  configuredKeys: string[],
  builderConfigured = false,
) {
  invalidateClientStatusRequests();
  const modelEngines = Object.fromEntries(
    (
      engines as Array<{
        name: string;
        label: string;
        defaultModel?: string;
        supportedModels?: string[];
        acceptsCustomModels?: boolean;
        preserveCustomModels?: boolean;
      }>
    ).map((engine) => [
      engine.name,
      {
        name: engine.name,
        label: engine.label,
        defaultModel: engine.defaultModel ?? engine.supportedModels?.[0] ?? "",
        supportedModels: engine.supportedModels ?? [],
        ...(engine.acceptsCustomModels ? { acceptsCustomModels: true } : {}),
        ...(engine.preserveCustomModels ? { preserveCustomModels: true } : {}),
      },
    ]),
  );
  modelCatalogMocks.load = async () => ({
    state: "available",
    groups: buildChatModelGroups({
      engines: engines as Parameters<typeof buildChatModelGroups>[0]["engines"],
      configuredKeys,
      builderConnected: builderConfigured,
    }),
    modelEngines,
    currentModelEngine: null,
    defaultModel: "gpt-5-6-luna",
    loadLiveGroups: async () => null,
  });
  actionMocks.callAction.mockResolvedValue({ engines } as never);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("env-status")) {
        return Response.json(
          configuredKeys.map((key) => ({ key, configured: true })),
        );
      }
      if (url.includes("builder/status")) {
        return Response.json({ configured: builderConfigured });
      }
      return Response.json({ value: null });
    }),
  );
}

function chatgptCatalog(model: string) {
  const groups = buildChatModelGroups({
    engines: [
      {
        name: CHATGPT_SUBSCRIPTION_ENGINE_NAME,
        label: "ChatGPT plan access",
        supportedModels: [model],
        requiredEnvVars: [],
        configured: true,
      },
    ],
  });
  return {
    state: "available" as const,
    groups,
    defaultModel: model,
    loadLiveGroups: async () => null,
  };
}

async function mountWithCatalog(
  engines: unknown[],
  configuredKeys: string[],
  builderConfigured = false,
) {
  stubCatalog(engines, configuredKeys, builderConfigured);
  const el = document.createElement("div");
  document.body.appendChild(el);
  const localRoot = createRoot(el);
  await act(async () => {
    localRoot.render(<MultiTabAssistantChat storageKey="catalog-test" />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    engineOf: () =>
      el
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-selected-engine") ?? null,
    modelOf: () =>
      el
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-selected-model") ?? null,
    catalogOf: () =>
      el
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-model-catalog") ?? null,
    async cleanup() {
      await act(async () => localRoot.unmount());
      el.remove();
    },
  };
}

chatThreadHookMocks.useChatThreads.mockImplementation(() => threadMocks);

function ReferenceProbe({
  threadId,
  selected,
}: {
  threadId: string;
  selected: boolean;
}) {
  const runtime = useLocalRuntime({ async *run() {} });
  return (
    <div data-reference-thread={threadId}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ComposerRuntimeAdaptersProvider
          adapters={{ builder: { isTrustedFrameMessage: () => true } }}
        >
          <TooltipProvider>
            <TiptapComposer
              disabled={assistantChatMockState.referenceDisabled}
              isReferenceTarget={selected}
              includeDefaultSlashSkills={false}
              plusMenuMode="hidden"
              voiceEnabled={false}
            />
          </TooltipProvider>
        </ComposerRuntimeAdaptersProvider>
      </AssistantRuntimeProvider>
    </div>
  );
}

vi.mock("./AgentKitAssistantChat.js", async () => {
  const React = await import("react");
  return {
    AgentKitAssistantChat: React.forwardRef(function AgentKitAssistantChatMock(
      _props: unknown,
      ref,
    ) {
      const props = _props as {
        threadId: string;
        composerSlot?: React.ReactNode;
        emptyStateAddon?: React.ReactNode;
        selectedModel?: string;
        selectedEngine?: string;
        selectedEffort?: string;
        availableModels?: Array<{
          engine: string;
          configured: boolean;
          models?: string[];
        }>;
        composerDisabled?: boolean;
        composerDisabledPlaceholder?: string;
        isActiveComposer?: boolean;
        isReferenceTarget?: boolean;
        isNewThread?: boolean;
        isThreadStateLoading?: boolean;
        contextScope?: ChatThreadScope | null;
        contextNamespace?: string;
        onThreadRestoreNotFound?: () => void;
        onRetryModelList?: () => void;
        onSlashCommand?: (command: string) => void;
        onForkedThread?: (threadId: string) => void;
        onGenerateTitle?: typeof assistantChatMockState.onGenerateTitle;
        onSaveThread?: typeof assistantChatMockState.onSaveThread;
        branchNavigation?: typeof assistantChatMockState.branchNavigation;
      };
      assistantChatMockState.onThreadRestoreNotFound =
        props.onThreadRestoreNotFound;
      assistantChatMockState.onRetryModelList = props.onRetryModelList;
      assistantChatMockState.onSlashCommand = props.onSlashCommand;
      assistantChatMockState.onForkedThread = props.onForkedThread;
      assistantChatMockState.onGenerateTitle = props.onGenerateTitle;
      assistantChatMockState.onSaveThread = props.onSaveThread;
      assistantChatMockState.branchNavigation = props.branchNavigation;
      React.useImperativeHandle(ref, () =>
        assistantChatMockState.deferredHandleThread === props.threadId
          ? null
          : {
              sendMessage: chatHandleMocks.sendMessage,
              implementPlan: chatHandleMocks.implementPlan,
              prefillMessage: assistantChatMockState.referenceProbe
                ? (message: string) => {
                    const element = document.querySelector(
                      `[data-reference-thread="${props.threadId}"]`,
                    );
                    assistantChatMockState.referenceDeliveries.push({
                      threadId: props.threadId,
                      context: element?.textContent ?? "",
                    });
                    chatHandleMocks.prefillMessage(message);
                  }
                : chatHandleMocks.prefillMessage,
              setComposerContextItem: chatHandleMocks.setComposerContextItem,
              canStageComposerContextItem:
                chatHandleMocks.canStageComposerContextItem,
              removeComposerContextItem:
                chatHandleMocks.removeComposerContextItem,
              clearComposerContextItems:
                chatHandleMocks.clearComposerContextItems,
              sendRecoveryMessage: chatHandleMocks.sendRecoveryMessage,
              queueMessage: chatHandleMocks.queueMessage,
              isRunning: () => false,
              hasInFlightWork: () => false,
              focusComposer: chatHandleMocks.focusComposer,
              exportThreadSnapshot: chatHandleMocks.exportThreadSnapshot,
            },
      );
      return (
        <div
          data-testid="assistant-chat"
          data-selected-model={props.selectedModel}
          data-selected-engine={props.selectedEngine}
          data-reasoning-effort={props.selectedEffort}
          data-model-catalog={props.availableModels
            ?.map((group) => `${group.engine}:${group.configured}`)
            .join(",")}
          data-model-options={props.availableModels
            ?.flatMap((group) => group.models ?? [])
            .join(",")}
          data-composer-disabled={props.composerDisabled ? "true" : "false"}
          data-composer-submission-disabled={
            props.composerSubmissionDisabled ? "true" : "false"
          }
          data-disabled-placeholder={props.composerDisabledPlaceholder}
          data-composer-active={props.isActiveComposer ? "true" : "false"}
          data-reference-target={props.isReferenceTarget ? "true" : "false"}
          data-new-thread={props.isNewThread ? "true" : "false"}
          data-thread-state-loading={
            props.isThreadStateLoading ? "true" : "false"
          }
          data-context-scope={
            props.contextScope
              ? `${props.contextScope.type}:${props.contextScope.id}`
              : undefined
          }
          data-context-namespace={props.contextNamespace}
        >
          {props.emptyStateAddon}
          {props.composerSlot}
          {assistantChatMockState.referenceProbe && (
            <ReferenceProbe
              threadId={props.threadId}
              selected={props.isReferenceTarget === true}
            />
          )}
        </div>
      );
    }),
  };
});

function resetThreadMocks() {
  assistantChatMockState.referenceProbe = false;
  assistantChatMockState.referenceDisabled = true;
  assistantChatMockState.deferredHandleThread = null;
  assistantChatMockState.referenceDeliveries = [];
  assistantChatMockState.onThreadRestoreNotFound = undefined;
  assistantChatMockState.onRetryModelList = undefined;
  assistantChatMockState.onSlashCommand = undefined;
  assistantChatMockState.onForkedThread = undefined;
  assistantChatMockState.onGenerateTitle = undefined;
  assistantChatMockState.onSaveThread = undefined;
  assistantChatMockState.branchNavigation = undefined;
  threadMocks.activeThreadId = "thread-1";
  threadMocks.isLoading = false;
  threadMocks.evictedThreadIds = [];
  threadMocks.threads = [
    {
      id: "thread-1",
      title: "Main thread",
      preview: "",
      messageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scope: null,
    },
  ];
  threadMocks.createThread.mockReset();
  threadMocks.createThread.mockImplementation(
    async (requestedId?: string) => requestedId ?? "thread-2",
  );
  threadMocks.openThread.mockReset();
  threadMocks.openThread.mockResolvedValue("opened");
  threadMocks.switchThread.mockReset();
  threadMocks.isNewThread.mockReset();
  threadMocks.isNewThread.mockReturnValue(false);
  threadMocks.pinThread.mockReset();
  threadMocks.pinThread.mockImplementation(async () => true);
  threadMocks.renameThread.mockReset();
  threadMocks.renameThread.mockImplementation(async () => true);
  chatThreadHookMocks.useChatThreads.mockReset();
  chatThreadHookMocks.useChatThreads.mockImplementation(() => threadMocks);
}

function dispatchSubmitChat(data: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "agentNative.submitChat",
        data,
      },
      origin: window.location.origin,
    }),
  );
}

function ensureLocalStorage() {
  if (window.localStorage) return;
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value)),
    } satisfies Storage,
  });
}

describe("MultiTabAssistantChat postMessage bridge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clearBufferedAgentChatRequests();
    resetThreadMocks();
    actionMocks.callAction.mockReset();
    actionMocks.callAction.mockResolvedValue(null as never);
    ensureLocalStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: null })),
    );
    window.localStorage.clear();
    window.localStorage.setItem(
      openTabsStorageKey("bridge-test"),
      JSON.stringify(["thread-1"]),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    clearAgentChatContext();
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(["custom", "message"])(
    "inserts %s references only into the selected mounted chat tab",
    async (transport) => {
      assistantChatMockState.referenceProbe = true;
      assistantChatMockState.referenceDisabled = false;
      threadMocks.threads.push({
        ...threadMocks.threads[0],
        id: "thread-2",
        title: "Other thread",
      });
      window.localStorage.setItem(
        openTabsStorageKey("bridge-test"),
        JSON.stringify(["thread-1", "thread-2"]),
      );
      const render = (id: string) => {
        threadMocks.activeThreadId = id;
        root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
      };
      threadMocks.switchThread.mockImplementation(render);
      await act(async () => render("thread-2"));
      await act(async () => render("thread-1"));
      expect(
        container.querySelectorAll("[data-reference-thread]"),
      ).toHaveLength(2);
      const reference = (label: string) => {
        const detail = {
          label,
          refType: "file",
          refId: "/selected.md",
          slotKey: "document",
          insertMessageId: `selected-${transport}`,
        };
        window.dispatchEvent(
          transport === "custom"
            ? new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, { detail })
            : new MessageEvent("message", {
                origin: window.location.origin,
                data: {
                  type: AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE,
                  data: detail,
                },
              }),
        );
      };
      await act(async () => reference("First selected document"));
      const first = container.querySelector(
        '[data-reference-thread="thread-1"]',
      )!;
      const second = container.querySelector(
        '[data-reference-thread="thread-2"]',
      )!;
      expect(first.textContent).toContain("First selected document");
      expect(second.textContent).not.toContain("First selected document");
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId: "thread-2" },
          }),
        ),
      );
      await act(async () => reference("Second selected document"));
      expect(second.textContent).toContain("Second selected document");
      expect(first.textContent).not.toContain("Second selected document");
    },
  );

  it.each([
    { transport: "custom", cold: false },
    { transport: "message", cold: false },
    { transport: "custom", cold: true },
    { transport: "message", cold: true },
  ])(
    "cancels a queued $transport reference when its selected tab changes (cold=$cold)",
    async ({ transport, cold }) => {
      assistantChatMockState.referenceProbe = true;
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      threadMocks.threads.push({
        ...threadMocks.threads[0],
        id: "thread-2",
        title: "Other thread",
      });
      window.localStorage.setItem(
        openTabsStorageKey("bridge-test"),
        JSON.stringify(["thread-1", "thread-2"]),
      );
      const sidebar = () => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <AgentSidebar
              defaultOpen={!cold}
              storageKey="bridge-test"
              showMissingApiKeySetup={false}
            >
              <div>Content</div>
            </AgentSidebar>
          </MemoryRouter>
        </QueryClientProvider>
      );
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(sidebar());
      });
      await act(async () => {
        root.render(sidebar());
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      if (cold) expect(container.querySelector(".tiptap")).toBeNull();
      const detail = {
        label: "Original tab document",
        refType: "file",
        refId: "/original-tab.md",
        slotKey: "document",
        insertMessageId: `original-tab-${transport}`,
      };
      const results: unknown[] = [];
      const recordResult = (event: Event) =>
        results.push((event as CustomEvent).detail);
      window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
      try {
        await act(async () => {
          window.dispatchEvent(
            transport === "custom"
              ? new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, { detail })
              : new MessageEvent("message", {
                  origin: window.location.origin,
                  data: {
                    type: AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE,
                    data: detail,
                  },
                }),
          );
          dispatchSubmitChat({
            message: "Use the original tab document",
            submit: false,
            openSidebar: false,
            submitMessageId: `original-tab-draft-${transport}-${cold}`,
          });
          window.dispatchEvent(
            new CustomEvent("agent-chat:open-thread", {
              detail: { threadId: "thread-2" },
            }),
          );
          dispatchSubmitChat({
            message: "Independent queued draft",
            targetTabId: "thread-2",
            submit: false,
            openSidebar: false,
          });
        });
        expect(threadMocks.openThread).not.toHaveBeenCalled();
        assistantChatMockState.referenceDisabled = false;
        await act(async () => threadMocks.switchThread("thread-2"));
        expect(results).toContainEqual({
          submitMessageId: `original-tab-draft-${transport}-${cold}`,
          delivered: false,
          reason: "reference-target-changed",
        });
        expect(threadMocks.openThread).toHaveBeenCalledWith("thread-2");
        expect(assistantChatMockState.referenceDeliveries).toEqual([
          {
            threadId: "thread-2",
            context: expect.not.stringContaining("Original tab document"),
          },
        ]);
        expect(
          container.querySelector('[data-reference-thread="thread-2"]')
            ?.textContent,
        ).not.toContain("Original tab document");
        const controls: string[] = [];
        const recordControl = (event: Event) => controls.push(event.type);
        window.addEventListener("agent-panel:open-settings", recordControl);
        window.addEventListener("agent-panel:set-mode", recordControl);
        try {
          await act(async () => {
            window.dispatchEvent(
              new CustomEvent("agent-panel:open-settings", {
                detail: { section: "api-keys" },
              }),
            );
            window.dispatchEvent(
              new CustomEvent("agent-panel:set-mode", {
                detail: { mode: "chat" },
              }),
            );
          });
          expect(controls).toEqual([
            "agent-panel:open-settings",
            "agent-panel:set-mode",
          ]);
          expect(assistantChatMockState.referenceDeliveries).toHaveLength(1);
        } finally {
          window.removeEventListener(
            "agent-panel:open-settings",
            recordControl,
          );
          window.removeEventListener("agent-panel:set-mode", recordControl);
        }
        await act(async () => threadMocks.switchThread("thread-1"));
        expect(assistantChatMockState.referenceDeliveries).toHaveLength(1);
        expect(
          container.querySelector('[data-reference-thread="thread-1"]')
            ?.textContent,
        ).not.toContain("Original tab document");
        await act(async () => {
          window.dispatchEvent(
            new CustomEvent("agent-chat:open-thread", {
              detail: { threadId: "thread-2" },
            }),
          );
          dispatchSubmitChat({
            message: "Independent draft after changing selection",
            submit: false,
            openSidebar: false,
          });
        });
        expect(threadMocks.openThread).toHaveBeenCalledWith("thread-2");
        expect(assistantChatMockState.referenceDeliveries).toEqual([
          {
            threadId: "thread-2",
            context: expect.not.stringContaining("Original tab document"),
          },
          {
            threadId: "thread-2",
            context: expect.not.stringContaining("Original tab document"),
          },
        ]);
        expect(
          container.querySelector('[data-reference-thread="thread-2"]')
            ?.textContent,
        ).not.toContain("Original tab document");
      } finally {
        window.removeEventListener(
          AGENT_CHAT_SUBMIT_RESULT_EVENT,
          recordResult,
        );
      }
    },
  );

  it.each([
    { closeMethod: "others", attachBeforeClose: false },
    { closeMethod: "all", attachBeforeClose: false },
    { closeMethod: "others", attachBeforeClose: true },
    { closeMethod: "all", attachBeforeClose: true },
  ])(
    "reports undelivered drafts when closing $closeMethod tabs (handle attached=$attachBeforeClose)",
    async ({ closeMethod, attachBeforeClose }) => {
      assistantChatMockState.deferredHandleThread = "thread-2";
      let header!: MultiTabAssistantChatHeaderProps;
      const results: unknown[] = [];
      const record = (event: Event) =>
        results.push((event as CustomEvent).detail);
      const chat = () => (
        <MultiTabAssistantChat
          storageKey="bridge-test"
          renderHeader={(props) => {
            header = props;
            return null;
          }}
        />
      );
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(chat());
      });
      threadMocks.createThread.mockImplementation(async () => {
        threadMocks.switchThread("thread-3");
        return "thread-3";
      });
      window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, record);
      try {
        await act(async () => root.render(chat()));
        await act(async () =>
          dispatchSubmitChat({
            message: "Undelivered draft",
            submit: false,
            targetTabId: "thread-2",
            submitMessageId: `pending-close-${closeMethod}-${attachBeforeClose}`,
          }),
        );
        expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
        if (attachBeforeClose) {
          assistantChatMockState.deferredHandleThread = null;
          await act(async () => root.render(chat()));
        }
        await act(async () => {
          if (closeMethod === "others") header.closeOtherTabs("thread-1");
          else await header.closeAllTabs();
        });
        expect(results).toEqual([
          {
            submitMessageId: `pending-close-${closeMethod}-${attachBeforeClose}`,
            delivered: false,
            reason: "target-tab-closed",
          },
        ]);
        assistantChatMockState.deferredHandleThread = null;
        await act(async () => root.render(chat()));
        await act(
          async () => new Promise((resolve) => setTimeout(resolve, 75)),
        );
        expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
        expect(results).toHaveLength(1);
      } finally {
        window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, record);
      }
    },
  );

  it.each([false, true])(
    "keeps later sends behind a scheduled delivery (submit=%s)",
    async (submit) => {
      assistantChatMockState.deferredHandleThread = "thread-2";
      const chat = () => <MultiTabAssistantChat storageKey="bridge-test" />;
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(chat());
      });
      await act(async () => root.render(chat()));
      await act(async () =>
        dispatchSubmitChat({
          message: "Earlier send",
          submit,
          targetTabId: "thread-2",
        }),
      );
      vi.useFakeTimers();
      try {
        assistantChatMockState.deferredHandleThread = null;
        await act(async () => root.render(chat()));
        await act(async () =>
          dispatchSubmitChat({
            message: "Later send",
            submit,
            targetTabId: "thread-2",
          }),
        );
        const delivered = submit
          ? chatHandleMocks.sendMessage
          : chatHandleMocks.prefillMessage;
        expect(delivered).not.toHaveBeenCalled();
        const reenter = () =>
          dispatchSubmitChat({
            message: "Reentrant send",
            submit,
            targetTabId: "thread-2",
          });
        if (submit)
          chatHandleMocks.sendMessage.mockImplementationOnce(async () => {
            reenter();
            return { status: "submitted" as const };
          });
        else chatHandleMocks.prefillMessage.mockImplementationOnce(reenter);
        await act(async () => vi.advanceTimersByTimeAsync(200));
        expect(delivered.mock.calls.map(([message]) => message)).toEqual([
          "Earlier send",
          "Later send",
          "Reentrant send",
        ]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("queues navigation prefill behind an older scheduled draft before acknowledging selection", async () => {
    assistantChatMockState.deferredHandleThread = "thread-2";
    const outcomes: string[] = [];
    const chat = () => (
      <MultiTabAssistantChat
        storageKey="bridge-test"
        onNavigationChange={(_event, outcome) => outcomes.push(outcome)}
      />
    );
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(chat());
    });
    await act(async () => root.render(chat()));
    await act(async () =>
      dispatchSubmitChat({
        message: "Earlier scheduled draft",
        submit: false,
        targetTabId: "thread-2",
      }),
    );
    vi.useFakeTimers();
    try {
      assistantChatMockState.deferredHandleThread = null;
      await act(async () => root.render(chat()));
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: {
              threadId: "thread-2",
              prefill: "Later navigation prefill",
            },
          }),
        ),
      );
      expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
      expect(outcomes).toEqual(["started"]);
      await act(async () =>
        dispatchSubmitChat({
          message: "Draft after navigation",
          submit: false,
          targetTabId: "thread-2",
        }),
      );
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(
        chatHandleMocks.prefillMessage.mock.calls.map(([message]) => message),
      ).toEqual(["Earlier scheduled draft", "Later navigation prefill"]);
      expect(outcomes).toEqual(["started", "selected"]);
      await act(async () => vi.advanceTimersByTimeAsync(50));
      expect(
        chatHandleMocks.prefillMessage.mock.calls.map(([message]) => message),
      ).toEqual([
        "Earlier scheduled draft",
        "Later navigation prefill",
        "Draft after navigation",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports failed navigation prefill and accepts an explicit retry", async () => {
    const outcomes: string[] = [];
    const failedEvents: CustomEvent[] = [];
    const chat = () => (
      <MultiTabAssistantChat
        storageKey="bridge-test"
        onNavigationChange={(event, outcome) => {
          outcomes.push(outcome);
          if (outcome === "failed") failedEvents.push(event as CustomEvent);
        }}
      />
    );
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(chat());
    });
    await act(async () => root.render(chat()));
    chatHandleMocks.prefillMessage.mockImplementationOnce(() => {
      throw new Error("Draft insertion failed");
    });
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: {
            threadId: "thread-2",
            prefill: "Retryable navigation draft",
            openRequestId: "failed-prefill-original-open",
          },
        }),
      );
    });
    expect(outcomes).toEqual(["started", "failed"]);
    expect(failedEvents[0].detail).toEqual({
      threadId: "thread-2",
      prefill: "Retryable navigation draft",
      openRequestId: "failed-prefill-original-open",
    });
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: {
            ...failedEvents[0].detail,
            openRequestId: "failed-prefill-retry-open",
          },
        }),
      );
    });
    expect(outcomes).toEqual(["started", "failed", "started", "selected"]);
    expect(chatHandleMocks.prefillMessage).toHaveBeenCalledTimes(2);
  });

  it("cancels drafts dependent on a failed navigation prefill", async () => {
    await mountNavigationSidebar();
    const results: unknown[] = [];
    const recordResult = (event: Event) =>
      results.push((event as CustomEvent).detail);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
    chatHandleMocks.prefillMessage.mockImplementationOnce(() => {
      throw new Error("Draft insertion failed");
    });
    try {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: {
              threadId: "thread-2",
              prefill: "Failed navigation draft",
            },
          }),
        );
        dispatchSubmitChat({
          message: "Dependent draft",
          submit: false,
          openSidebar: false,
          submitMessageId: "failed-navigation-dependent-draft",
        });
      });
      expect(results).toEqual([
        {
          submitMessageId: "failed-navigation-dependent-draft",
          delivered: false,
          reason: "navigation-failed",
        },
      ]);
      expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalledWith(
        "Dependent draft",
      );
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId: "thread-2", prefill: "Explicit retry draft" },
          }),
        );
      });
      expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
        "Explicit retry draft",
      );
    } finally {
      window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
    }
  });

  it("retires a navigation prefill waiting in a delivery lane", async () => {
    assistantChatMockState.deferredHandleThread = "thread-2";
    const outcomes: string[] = [];
    const chat = () => (
      <MultiTabAssistantChat
        storageKey="bridge-test"
        onNavigationChange={(_event, outcome) => outcomes.push(outcome)}
      />
    );
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(chat());
    });
    await act(async () => root.render(chat()));
    await act(async () =>
      dispatchSubmitChat({
        message: "Earlier lane owner",
        submit: false,
        targetTabId: "thread-2",
      }),
    );
    vi.useFakeTimers();
    try {
      assistantChatMockState.deferredHandleThread = null;
      await act(async () => root.render(chat()));
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId: "thread-2", prefill: "Retired queued prefill" },
          }),
        ),
      );
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId: "thread-2", prefill: "Current queued prefill" },
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(150));
      expect(
        chatHandleMocks.prefillMessage.mock.calls.map(([message]) => message),
      ).toEqual(["Earlier lane owner", "Current queued prefill"]);
      expect(outcomes).toEqual([
        "started",
        "started",
        "superseded",
        "selected",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes the delivery head after its handle disappears at handoff", async () => {
    assistantChatMockState.deferredHandleThread = "thread-2";
    const chat = () => <MultiTabAssistantChat storageKey="bridge-test" />;
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(chat());
    });
    await act(async () => root.render(chat()));
    await act(async () =>
      dispatchSubmitChat({
        message: "Waiting head",
        submit: false,
        targetTabId: "thread-2",
      }),
    );
    vi.useFakeTimers();
    try {
      assistantChatMockState.deferredHandleThread = null;
      await act(async () => root.render(chat()));
      assistantChatMockState.deferredHandleThread = "thread-2";
      await act(async () => root.render(chat()));
      await act(async () => vi.advanceTimersByTimeAsync(50));
      await act(async () =>
        dispatchSubmitChat({
          message: "Later waiting send",
          submit: false,
          targetTabId: "thread-2",
        }),
      );
      expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
      assistantChatMockState.deferredHandleThread = null;
      await act(async () => root.render(chat()));
      await act(async () => vi.advanceTimersByTimeAsync(150));
      expect(
        chatHandleMocks.prefillMessage.mock.calls.map(([message]) => message),
      ).toEqual(["Waiting head", "Later waiting send"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["agent-chat:open-thread", "agent-task-open"])(
    "preserves the actual destination when %s follows blocked conversation work",
    async (type) => {
      assistantChatMockState.referenceProbe = true;
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      threadMocks.threads.push({
        ...threadMocks.threads[0],
        id: "thread-2",
        title: "Other thread",
      });
      const sidebar = () => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <AgentSidebar
              defaultOpen
              storageKey="bridge-test"
              showMissingApiKeySetup={false}
            >
              <div>Content</div>
            </AgentSidebar>
          </MemoryRouter>
        </QueryClientProvider>
      );
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(sidebar());
      });
      await act(async () => {
        root.render(sidebar());
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
            detail: {
              label: "Original document",
              refType: "file",
              refId: "/original.md",
              slotKey: "document",
              insertMessageId: `ordered-${type}`,
            },
          }),
        );
        dispatchSubmitChat({
          message: "Use this document",
          submit: false,
          openSidebar: false,
        });
        window.dispatchEvent(
          new CustomEvent(type, { detail: { threadId: "thread-2" } }),
        );
      });
      expect(threadMocks.activeThreadId).toBe("thread-1");
      expect(assistantChatMockState.referenceDeliveries).toEqual([]);
      assistantChatMockState.referenceDisabled = false;
      await act(async () => root.render(sidebar()));
      expect(assistantChatMockState.referenceDeliveries).toEqual([
        {
          threadId: "thread-1",
          context: expect.stringContaining("Original document"),
        },
      ]);
      expect(threadMocks.switchThread).toHaveBeenCalledWith("thread-2");
      expect(threadMocks.activeThreadId).toBe("thread-2");
    },
  );

  it("cancels closed-tab reference work and releases later navigation", async () => {
    assistantChatMockState.referenceProbe = true;
    threadMocks.threads.push({ ...threadMocks.threads[0], id: "thread-2" });
    window.localStorage.setItem(
      openTabsStorageKey("bridge-test"),
      JSON.stringify(["thread-1", "thread-2"]),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const sidebar = () => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentSidebar
            defaultOpen
            storageKey="bridge-test"
            showMissingApiKeySetup={false}
          >
            <div>Content</div>
          </AgentSidebar>
        </MemoryRouter>
      </QueryClientProvider>
    );
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(sidebar());
    });
    const results: unknown[] = [];
    const recordResult = (event: Event) =>
      results.push((event as CustomEvent).detail);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
    try {
      await act(async () => {
        root.render(sidebar());
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
            detail: {
              label: "Closed tab document",
              refType: "file",
              refId: "/closed.md",
              slotKey: "document",
              insertMessageId: "closed-reference",
            },
          }),
        );
        dispatchSubmitChat({
          message: "Needs the closed document",
          submit: false,
          openSidebar: false,
          submitMessageId: "closed-dependent",
        });
        dispatchSubmitChat({
          message: "Independent B draft",
          targetTabId: "thread-2",
          submit: false,
          openSidebar: false,
        });
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId: "thread-2" },
          }),
        );
        window.dispatchEvent(new CustomEvent("agent-chat:close-current-tab"));
      });
      expect(threadMocks.openThread).toHaveBeenCalledWith("thread-2");
      expect(results).toContainEqual({
        submitMessageId: "closed-dependent",
        delivered: false,
        reason: "target-tab-closed",
      });
      expect(assistantChatMockState.referenceDeliveries).toEqual([
        {
          threadId: "thread-2",
          context: expect.not.stringContaining("Closed tab document"),
        },
      ]);
      assistantChatMockState.referenceDisabled = false;
      await act(async () => threadMocks.switchThread("thread-1"));
      expect(assistantChatMockState.referenceDeliveries).toHaveLength(1);
    } finally {
      window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
    }
  });

  it("cancels dependent drafts when selection changes during reference replay", async () => {
    const sidebar = await mountNavigationSidebar();
    assistantChatMockState.referenceDisabled = true;
    await act(async () => root.render(sidebar()));
    const results: Array<{
      submitMessageId?: string;
      delivered: boolean;
      reason?: string;
    }> = [];
    const recordResult = (event: Event) => {
      const result = (event as CustomEvent).detail;
      results.push(result);
      if (
        result.submitMessageId === "reentrant-selection-first" &&
        !result.delivered
      ) {
        expect(claimAgentChatSubmit("reentrant-selection-second")).toBe(false);
        expect(isAgentChatSubmitCancelled("reentrant-selection-first")).toBe(
          false,
        );
        dispatchSubmitChat({
          message: "Fresh explicit B draft",
          targetTabId: "thread-2",
          submit: false,
          openSidebar: false,
        });
      }
    };
    const switchDuringReplay = () => {
      flushSync(() => threadMocks.switchThread("thread-2"));
      flushSync(() => threadMocks.switchThread("thread-1"));
    };
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
    window.addEventListener(
      AGENT_CHAT_INSERT_REFERENCE_EVENT,
      switchDuringReplay,
    );
    try {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
            detail: {
              label: "Committed A reference",
              refType: "file",
              refId: "/reentrant-selection.md",
              slotKey: "document",
              insertMessageId: "reentrant-selection-reference",
            },
          }),
        );
        for (const suffix of ["first", "second"])
          dispatchSubmitChat({
            message: `Dependent ${suffix}`,
            submit: false,
            openSidebar: false,
            submitMessageId: `reentrant-selection-${suffix}`,
          });
      });
      assistantChatMockState.referenceDisabled = false;
      await act(async () => root.render(sidebar()));
      expect(results.filter((result) => !result.delivered)).toEqual([
        {
          submitMessageId: "reentrant-selection-first",
          delivered: false,
          reason: "reference-target-changed",
        },
        {
          submitMessageId: "reentrant-selection-second",
          delivered: false,
          reason: "reference-target-changed",
        },
      ]);
      expect(chatHandleMocks.prefillMessage).toHaveBeenCalledExactlyOnceWith(
        "Fresh explicit B draft",
      );
      expect(assistantChatMockState.referenceDeliveries).toEqual([
        {
          threadId: "thread-2",
          context: expect.not.stringContaining("Committed A reference"),
        },
      ]);
      expect(threadMocks.activeThreadId).toBe("thread-1");
    } finally {
      window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
      window.removeEventListener(
        AGENT_CHAT_INSERT_REFERENCE_EVENT,
        switchDuringReplay,
      );
    }
  });

  async function mountNavigationSidebar(cold = false, destinationOpen = true) {
    assistantChatMockState.referenceProbe = true;
    assistantChatMockState.referenceDisabled = false;
    threadMocks.threads.push({
      ...threadMocks.threads[0],
      id: "thread-2",
      title: "Destination",
    });
    window.localStorage.setItem(
      openTabsStorageKey("bridge-test"),
      JSON.stringify(destinationOpen ? ["thread-1", "thread-2"] : ["thread-1"]),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const sidebar = () => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentSidebar
            defaultOpen={!cold}
            storageKey="bridge-test"
            showMissingApiKeySetup={false}
          >
            <div>Content</div>
          </AgentSidebar>
        </MemoryRouter>
      </QueryClientProvider>
    );
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(sidebar());
    });
    await act(async () => root.render(sidebar()));
    return sidebar;
  }

  it("cancels in-flight navigation when its inactive destination closes", async () => {
    let finishLookup!: (result: "opened") => void;
    threadMocks.openThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    await mountNavigationSidebar();
    const results: unknown[] = [];
    const recordResult = (event: Event) =>
      results.push((event as CustomEvent).detail);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
    try {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId: "thread-2" },
          }),
        );
        window.dispatchEvent(
          new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
            detail: {
              label: "Closed lookup document",
              refType: "file",
              refId: "/lookup.md",
              slotKey: "document",
              insertMessageId: "closed-lookup-reference",
            },
          }),
        );
        dispatchSubmitChat({
          message: "Closed lookup draft",
          submit: false,
          openSidebar: false,
          submitMessageId: "closed-lookup-draft",
        });
        dispatchSubmitChat({
          message: "Independent A draft",
          submit: false,
          openSidebar: false,
          targetTabId: "thread-1",
        });
      });
      const destination = [
        ...container.querySelectorAll('button,[role="button"]'),
      ].find((button) => button.textContent === "Destination");
      const close =
        destination?.parentElement?.querySelector<HTMLButtonElement>(
          'button[aria-label="Close tab"]',
        );
      expect(close).toBeTruthy();
      await act(async () => close!.click());
      expect(results).toContainEqual({
        submitMessageId: "closed-lookup-draft",
        delivered: false,
        reason: "navigation-closed",
      });
      await act(async () => finishLookup("opened"));
      expect(threadMocks.activeThreadId).toBe("thread-1");
      expect(assistantChatMockState.referenceDeliveries).toEqual([
        {
          threadId: "thread-1",
          context: expect.not.stringContaining("Closed lookup document"),
        },
      ]);
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId: "thread-2" },
          }),
        ),
      );
      expect(threadMocks.activeThreadId).toBe("thread-2");
    } finally {
      window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
    }
  });

  it.each([
    ["others", true],
    ["all", true],
    ["others", false],
    ["all", false],
  ] as const)(
    "invalidates in-flight destinations when closing %s tabs (alreadyOpen=%s)",
    async (closeMethod, alreadyOpen) => {
      let finishLookup!: (result: "opened") => void;
      threadMocks.openThread.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLookup = resolve;
          }),
      );
      if (alreadyOpen)
        threadMocks.threads.push({ ...threadMocks.threads[0], id: "thread-2" });
      window.localStorage.setItem(
        openTabsStorageKey("close-navigation"),
        JSON.stringify(alreadyOpen ? ["thread-1", "thread-2"] : ["thread-1"]),
      );
      let header!: MultiTabAssistantChatHeaderProps;
      const outcomes: string[] = [];
      const chat = () => (
        <MultiTabAssistantChat
          storageKey="close-navigation"
          renderHeader={(props) => {
            header = props;
            return null;
          }}
          onNavigationChange={(_event, outcome) => outcomes.push(outcome)}
        />
      );
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(chat());
      });
      threadMocks.createThread.mockImplementation(async () => {
        threadMocks.switchThread("thread-3");
        return "thread-3";
      });
      await act(async () => root.render(chat()));
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: {
              threadId: "thread-2",
              prefill: "Cancelled navigation prefill",
            },
          }),
        ),
      );
      await act(async () => {
        if (closeMethod === "others") header.closeOtherTabs("thread-1");
        else await header.closeAllTabs();
      });
      expect(outcomes).toEqual(["started", "closed"]);
      await act(async () => finishLookup("opened"));
      expect(threadMocks.activeThreadId).toBe(
        closeMethod === "others" ? "thread-1" : "thread-3",
      );
      expect(header.tabs.some((tab) => tab.id === "thread-2")).toBe(false);
      expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalledWith(
        "Cancelled navigation prefill",
      );
      expect(outcomes).toEqual(["started", "closed"]);
    },
  );

  it("cancels in-flight opens once the close-all replacement is available", async () => {
    let finishLookup!: (result: "opened") => void;
    let finishReplacement!: (id: string) => void;
    threadMocks.openThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    threadMocks.createThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReplacement = resolve;
        }),
    );
    let header!: MultiTabAssistantChatHeaderProps;
    const outcomes: string[] = [];
    const chat = () => (
      <MultiTabAssistantChat
        storageKey="close-navigation"
        renderHeader={(props) => {
          header = props;
          return null;
        }}
        onNavigationChange={(_event, outcome) => outcomes.push(outcome)}
      />
    );
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(chat());
    });
    await act(async () => root.render(chat()));
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: {
            threadId: "thread-2",
            prefill: "Cancelled navigation prefill",
          },
        }),
      ),
    );
    let closing!: Promise<void>;
    await act(async () => {
      closing = header.closeAllTabs();
    });
    expect(outcomes).toEqual(["started"]);
    expect(threadMocks.activeThreadId).toBe("thread-1");
    expect(header.tabs.some((tab) => tab.id === "thread-2")).toBe(false);
    await act(async () => {
      finishReplacement("thread-3");
      await closing;
    });
    expect(threadMocks.activeThreadId).toBe("thread-3");
    expect(outcomes).toEqual(["started", "closed"]);
    await act(async () => finishLookup("opened"));
    expect(threadMocks.activeThreadId).toBe("thread-3");
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalledWith(
      "Cancelled navigation prefill",
    );
  });

  it("shares one optimistic replacement for overlapping close-all calls", async () => {
    let finishReplacement!: (id: string) => void;
    const drafts: string[] = [];
    let header!: MultiTabAssistantChatHeaderProps;
    const closedTabs: string[][] = [];
    const chat = () => (
      <MultiTabAssistantChat
        storageKey="close-navigation"
        renderHeader={(props) => {
          header = props;
          return null;
        }}
        onTabsClosed={(ids) => closedTabs.push(ids)}
      />
    );
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(chat());
    });
    threadMocks.createThread.mockImplementation(() => {
      const id = `replacement-${drafts.length + 1}`;
      drafts.push(id);
      threadMocks.activeThreadId = id;
      root.render(chat());
      return new Promise((resolve) => {
        finishReplacement = resolve;
      });
    });
    await act(async () => root.render(chat()));
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = header.closeAllTabs();
      second = header.closeAllTabs();
    });
    expect(threadMocks.createThread).toHaveBeenCalledTimes(1);
    expect(drafts).toEqual(["replacement-1"]);
    await act(async () => {
      finishReplacement("replacement-1");
      await Promise.all([first, second]);
    });
    expect(threadMocks.activeThreadId).toBe("replacement-1");
    expect(header.tabs.map((tab) => tab.id)).toEqual(["replacement-1"]);
    expect(closedTabs).toEqual([["thread-1"]]);
    let next!: Promise<void>;
    await act(async () => {
      next = header.closeAllTabs();
    });
    expect(drafts).toEqual(["replacement-1", "replacement-2"]);
    await act(async () => {
      finishReplacement("replacement-2");
      await next;
    });
    expect(header.tabs.map((tab) => tab.id)).toEqual(["replacement-2"]);
    expect(closedTabs).toEqual([["thread-1"], ["replacement-1"]]);
  });

  it.each(["creator", "closing callback"])(
    "shares the close-all operation with a reentrant %s",
    async (source) => {
      let header!: MultiTabAssistantChatHeaderProps;
      let nested!: Promise<void>;
      const chat = () => (
        <MultiTabAssistantChat
          renderHeader={(props) => {
            header = props;
            return null;
          }}
          onTabsClosing={() => {
            if (source === "closing callback") nested = header.closeAllTabs();
          }}
        />
      );
      threadMocks.createThread.mockImplementationOnce(() => {
        if (source === "creator") nested = header.closeAllTabs();
        threadMocks.activeThreadId = "thread-2";
        root.render(chat());
        return Promise.resolve("thread-2");
      });
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(chat());
      });
      await act(async () => root.render(chat()));
      let closing!: Promise<void>;
      await act(async () => {
        closing = header.closeAllTabs();
        await closing;
      });
      expect(nested).toBe(closing);
      expect(threadMocks.createThread).toHaveBeenCalledTimes(1);
      expect(header.tabs.map((tab) => tab.id)).toEqual(["thread-2"]);
    },
  );

  it.each(["throw", "reject", "null"])(
    "releases the shared close-all operation after creation fails (%s)",
    async (result) => {
      const failure = new Error("Replacement unavailable");
      if (result === "throw")
        threadMocks.createThread.mockImplementationOnce(() => {
          throw failure;
        });
      else if (result === "reject")
        threadMocks.createThread.mockRejectedValueOnce(failure);
      else threadMocks.createThread.mockResolvedValueOnce(null);
      let header!: MultiTabAssistantChatHeaderProps;
      const closed = vi.fn();
      const chat = () => (
        <MultiTabAssistantChat
          renderHeader={(props) => {
            header = props;
            return null;
          }}
          onTabsClosed={closed}
        />
      );
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(chat());
      });
      await act(async () => root.render(chat()));
      await act(async () => {
        const first = header.closeAllTabs();
        const second = header.closeAllTabs();
        expect(second).toBe(first);
        const outcomes = await Promise.allSettled([first, second]);
        expect(outcomes).toEqual(
          result === "null"
            ? [
                { status: "fulfilled", value: undefined },
                { status: "fulfilled", value: undefined },
              ]
            : [
                { status: "rejected", reason: failure },
                { status: "rejected", reason: failure },
              ],
        );
      });
      expect(threadMocks.createThread).toHaveBeenCalledTimes(1);
      expect(closed).not.toHaveBeenCalled();
      expect(header.tabs.map((tab) => tab.id)).toEqual(["thread-1"]);
      await act(async () => {
        await header.closeAllTabs();
      });
      expect(threadMocks.createThread).toHaveBeenCalledTimes(2);
      expect(header.tabs.map((tab) => tab.id)).toEqual(["thread-2"]);
      expect(closed).toHaveBeenCalledTimes(1);
    },
  );

  it("reports tabs opened during delayed close-all replacement cleanup", async () => {
    let finishReplacement!: (id: string) => void;
    threadMocks.createThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReplacement = resolve;
        }),
    );
    let header!: MultiTabAssistantChatHeaderProps;
    const closedTabs: string[][] = [];
    const chat = () => (
      <MultiTabAssistantChat
        storageKey="close-navigation"
        renderHeader={(props) => {
          header = props;
          return null;
        }}
        onTabsClosed={(ids) => closedTabs.push(ids)}
      />
    );
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(chat());
    });
    await act(async () => root.render(chat()));
    let closing!: Promise<void>;
    await act(async () => {
      closing = header.closeAllTabs();
    });
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId: "thread-2" },
        }),
      ),
    );
    expect(threadMocks.activeThreadId).toBe("thread-2");
    expect(closedTabs).toEqual([]);
    await act(async () => {
      finishReplacement("thread-3");
      await closing;
    });
    expect(threadMocks.activeThreadId).toBe("thread-3");
    expect(header.tabs.some((tab) => tab.id === "thread-2")).toBe(false);
    expect(closedTabs).toEqual([["thread-1", "thread-2"]]);
  });

  it("preserves a pending open for the close-other-tabs survivor", async () => {
    let finishLookup!: (result: "opened") => void;
    threadMocks.openThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    let header!: MultiTabAssistantChatHeaderProps;
    const outcomes: string[] = [];
    const chat = () => (
      <MultiTabAssistantChat
        storageKey="close-navigation"
        renderHeader={(props) => {
          header = props;
          return null;
        }}
        onNavigationChange={(_event, outcome) => outcomes.push(outcome)}
      />
    );
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(chat());
    });
    await act(async () => root.render(chat()));
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: {
            threadId: "thread-1",
            prefill: "Surviving navigation prefill",
          },
        }),
      ),
    );
    await act(async () => header.closeOtherTabs("thread-1"));
    expect(outcomes).toEqual(["started"]);
    await act(async () => finishLookup("opened"));
    expect(threadMocks.activeThreadId).toBe("thread-1");
    expect(outcomes).toEqual(["started", "selected"]);
    expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
      "Surviving navigation prefill",
    );
  });

  it.each(["agent-chat:open-thread", "agent-task-open"])(
    "retires a superseded lookup before its response arrives (%s)",
    async (eventType) => {
      let finishLookup!: (result: "opened") => void;
      threadMocks.openThread.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLookup = resolve;
          }),
      );
      const active = new Set<Event>();
      const outcomes: Array<{ threadId: string; outcome: string }> = [];
      const chat = () => (
        <MultiTabAssistantChat
          storageKey="bridge-test"
          onNavigationChange={(event, outcome) => {
            outcomes.push({
              threadId: (event as CustomEvent).detail.threadId,
              outcome,
            });
            if (outcome === "started") active.add(event);
            else active.delete(event);
          }}
        />
      );
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(chat());
      });
      await act(async () => root.render(chat()));
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId: "thread-2", prefill: "Stale prefill" },
          }),
        ),
      );
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent(eventType, {
            detail: { threadId: "thread-3", prefill: "Current prefill" },
          }),
        ),
      );
      expect(threadMocks.activeThreadId).toBe("thread-3");
      expect(active.size).toBe(0);
      expect(
        outcomes.filter(
          ({ threadId, outcome }) =>
            threadId === "thread-2" && outcome === "superseded",
        ),
      ).toHaveLength(1);
      await act(async () => finishLookup("opened"));
      expect(threadMocks.activeThreadId).toBe("thread-3");
      expect(active.size).toBe(0);
      expect(
        outcomes.filter(
          ({ threadId, outcome }) =>
            threadId === "thread-2" && outcome === "superseded",
        ),
      ).toHaveLength(1);
      expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalledWith(
        "Stale prefill",
      );
    },
  );

  it.each(["agent-chat:open-thread", "agent-task-open"])(
    "keeps a callback-created navigation ahead of an older %s request",
    async (eventType) => {
      const outcomes: Array<{ threadId: string; outcome: string }> = [];
      const chat = () => (
        <MultiTabAssistantChat
          storageKey="bridge-test"
          onNavigationChange={(event, outcome) => {
            const threadId = (event as CustomEvent).detail.threadId;
            outcomes.push({ threadId, outcome });
            if (threadId === "thread-2" && outcome === "started")
              window.dispatchEvent(
                new CustomEvent("agent-chat:open-thread", {
                  detail: { threadId: "thread-3", prefill: "Newest draft" },
                }),
              );
          }}
        />
      );
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(chat());
      });
      await act(async () => root.render(chat()));
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent(eventType, {
            detail: { threadId: "thread-2", prefill: "Older draft" },
          }),
        ),
      );
      expect(threadMocks.openThread.mock.calls.map((call) => call[0])).toEqual([
        "thread-3",
      ]);
      expect(threadMocks.activeThreadId).toBe("thread-3");
      expect(threadMocks.switchThread).not.toHaveBeenCalledWith("thread-2");
      expect(outcomes).toContainEqual({
        threadId: "thread-2",
        outcome: "superseded",
      });
      expect(outcomes).toContainEqual({
        threadId: "thread-3",
        outcome: "selected",
      });
      expect(chatHandleMocks.prefillMessage).toHaveBeenCalledExactlyOnceWith(
        "Newest draft",
      );
    },
  );

  it("discards a superseded prefill for the same destination", async () => {
    assistantChatMockState.deferredHandleThread = "thread-2";
    const chat = () => <MultiTabAssistantChat storageKey="bridge-test" />;
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(chat());
    });
    await act(async () => root.render(chat()));
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId: "thread-2", prefill: "Superseded prefill" },
        }),
      ),
    );
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId: "thread-2", prefill: "Current same-tab prefill" },
        }),
      ),
    );
    assistantChatMockState.deferredHandleThread = null;
    await act(async () => root.render(chat()));
    expect(chatHandleMocks.prefillMessage).toHaveBeenCalledExactlyOnceWith(
      "Current same-tab prefill",
    );
  });

  it("retires an unresolved lookup when its replacement is unavailable", async () => {
    let finishLookup!: (result: "opened") => void;
    threadMocks.openThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    threadMocks.openThread.mockResolvedValueOnce("unavailable");
    const outcomes: Array<{ threadId: string; outcome: string }> = [];
    await act(async () =>
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          onNavigationChange={(event, outcome) =>
            outcomes.push({
              threadId: (event as CustomEvent).detail.threadId,
              outcome,
            })
          }
        />,
      ),
    );
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId: "thread-2" },
        }),
      ),
    );
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId: "thread-3" },
        }),
      ),
    );
    expect(outcomes).toContainEqual({
      threadId: "thread-2",
      outcome: "superseded",
    });
    expect(outcomes).toContainEqual({
      threadId: "thread-3",
      outcome: "unavailable",
    });
    const settled = [...outcomes];
    await act(async () => finishLookup("opened"));
    expect(outcomes).toEqual(settled);
    expect(threadMocks.switchThread).not.toHaveBeenCalled();
  });

  it.each(["agent-chat:open-thread", "agent-task-open"])(
    "does not reopen a %s destination closed by its start callback",
    async (eventType) => {
      let header!: MultiTabAssistantChatHeaderProps;
      const outcomes: string[] = [];
      const chat = () => (
        <MultiTabAssistantChat
          storageKey="bridge-test"
          renderHeader={(props) => {
            header = props;
            return null;
          }}
          onNavigationChange={(_event, outcome) => {
            outcomes.push(outcome);
            if (outcome === "started") header.closeOtherTabs("thread-1");
          }}
        />
      );
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(chat());
      });
      await act(async () => root.render(chat()));
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent(eventType, {
            detail: { threadId: "thread-2", prefill: "Cancelled draft" },
          }),
        ),
      );
      expect(threadMocks.openThread).not.toHaveBeenCalled();
      expect(threadMocks.activeThreadId).toBe("thread-1");
      expect(threadMocks.switchThread).not.toHaveBeenCalledWith("thread-2");
      expect(outcomes).toEqual(["started", "closed"]);
      expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalledWith(
        "Cancelled draft",
      );
    },
  );

  it.each(["others", "all"] as const)(
    "retains callback-created navigation after closing %s tabs",
    async (closeMethod) => {
      let finishOldLookup!: (result: "opened") => void;
      threadMocks.openThread.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOldLookup = resolve;
          }),
      );
      let header!: MultiTabAssistantChatHeaderProps;
      const outcomes: string[] = [];
      const chat = () => (
        <MultiTabAssistantChat
          storageKey="close-navigation"
          renderHeader={(props) => {
            header = props;
            return null;
          }}
          onNavigationChange={(_event, outcome) => {
            outcomes.push(outcome);
            if (outcome === "closed")
              window.dispatchEvent(
                new CustomEvent("agent-chat:open-thread", {
                  detail: {
                    threadId: "thread-2",
                    prefill: "Fresh callback prefill",
                  },
                }),
              );
          }}
        />
      );
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(chat());
      });
      threadMocks.createThread.mockImplementation(async () => {
        threadMocks.switchThread("thread-3");
        return "thread-3";
      });
      await act(async () => root.render(chat()));
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: {
              threadId: "thread-2",
              prefill: "Cancelled original prefill",
            },
          }),
        ),
      );
      await act(async () => {
        if (closeMethod === "others") header.closeOtherTabs("thread-1");
        else await header.closeAllTabs();
      });
      expect(outcomes).toEqual(["started", "closed", "started", "selected"]);
      expect(threadMocks.activeThreadId).toBe("thread-2");
      expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
        "Fresh callback prefill",
      );
      await act(async () => finishOldLookup("opened"));
      expect(outcomes).toEqual(["started", "closed", "started", "selected"]);
      expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalledWith(
        "Cancelled original prefill",
      );
    },
  );

  it.each(["throw", "reject", "empty", "null"])(
    "keeps queued work when close-all replacement fails (%s)",
    async (result) => {
      assistantChatMockState.deferredHandleThread = "thread-1";
      let finishLookup!: (result: "opened") => void;
      threadMocks.openThread.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLookup = resolve;
          }),
      );
      const failure = new Error("Replacement unavailable");
      if (result === "throw")
        threadMocks.createThread.mockImplementationOnce(() => {
          throw failure;
        });
      else if (result === "reject")
        threadMocks.createThread.mockRejectedValueOnce(failure);
      else if (result === "null")
        threadMocks.createThread.mockResolvedValueOnce(null);
      else threadMocks.createThread.mockResolvedValueOnce("");
      let header!: MultiTabAssistantChatHeaderProps;
      const outcomes: string[] = [];
      const closing = vi.fn();
      const results: Array<{ submitMessageId: string; delivered: boolean }> =
        [];
      const record = (event: Event) =>
        results.push((event as CustomEvent).detail);
      window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, record);
      try {
        const pendingId = `failed-close-${result}`;
        const chat = () => (
          <MultiTabAssistantChat
            storageKey="close-navigation"
            renderHeader={(props) => {
              header = props;
              return null;
            }}
            onNavigationChange={(_event, outcome) => outcomes.push(outcome)}
            onTabsClosing={closing}
          />
        );
        threadMocks.switchThread.mockImplementation((id: string) => {
          threadMocks.activeThreadId = id;
          root.render(chat());
        });
        await act(async () => root.render(chat()));
        await act(async () =>
          dispatchSubmitChat({
            message: "Kept draft",
            submit: false,
            targetTabId: "thread-1",
            submitMessageId: pendingId,
          }),
        );
        await act(async () =>
          window.dispatchEvent(
            new CustomEvent("agent-chat:open-thread", {
              detail: { threadId: "thread-2" },
            }),
          ),
        );
        await act(async () => {
          if (result === "reject" || result === "throw")
            await expect(header.closeAllTabs()).rejects.toBe(failure);
          else await header.closeAllTabs();
        });
        expect(outcomes).toEqual(["started"]);
        expect(closing).not.toHaveBeenCalled();
        expect(
          results.filter((result) => result.submitMessageId === pendingId),
        ).toEqual([]);
        expect(header.tabs.some((tab) => tab.id === "thread-1")).toBe(true);
        expect(threadMocks.activeThreadId).toBe("thread-1");
        await act(async () => finishLookup("opened"));
        expect(threadMocks.activeThreadId).toBe("thread-2");
        expect(outcomes).toEqual(["started", "selected"]);
        assistantChatMockState.deferredHandleThread = null;
        await act(async () => root.render(chat()));
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 75));
        });
        expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
          "Kept draft",
        );
        expect(
          results.filter(
            (result) =>
              result.submitMessageId === pendingId && !result.delivered,
          ),
        ).toEqual([]);
        await act(async () =>
          dispatchSubmitChat({
            message: "Still usable",
            submit: false,
            targetTabId: "thread-1",
          }),
        );
        expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
          "Still usable",
        );
      } finally {
        window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, record);
      }
    },
  );

  it("settles unavailable opens on unmount during replacement creation exactly once", async () => {
    let finishLookup!: (result: "opened") => void;
    let finishReplacement!: (id: string) => void;
    threadMocks.openThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    threadMocks.createThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReplacement = resolve;
        }),
    );
    let header!: MultiTabAssistantChatHeaderProps;
    const outcomes: string[] = [];
    const publish = vi.fn();
    await act(async () =>
      root.render(
        <MultiTabAssistantChat
          storageKey="close-navigation"
          renderHeader={(props) => {
            header = props;
            return null;
          }}
          onNavigationChange={(_event, outcome) => outcomes.push(outcome)}
          onTabsClosing={() => publish}
        />,
      ),
    );
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId: "thread-2" },
        }),
      ),
    );
    let closing!: Promise<void>;
    await act(async () => {
      closing = header.closeAllTabs();
    });
    expect(outcomes).toEqual(["started"]);
    await act(async () => root.render(<div />));
    expect(outcomes).toEqual(["started", "unavailable"]);
    expect(publish).not.toHaveBeenCalled();
    await act(async () => {
      finishLookup("opened");
      finishReplacement("thread-3");
      await closing;
    });
    expect(outcomes).toEqual(["started", "unavailable"]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes final-tab closure after replacement so callback recovery survives", async () => {
    let finishLookup!: (result: "opened") => void;
    let finishReplacement!: (id: string) => void;
    threadMocks.openThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    threadMocks.createThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReplacement = resolve;
        }),
    );
    let header!: MultiTabAssistantChatHeaderProps;
    const outcomes: string[] = [];
    const chat = () => (
      <MultiTabAssistantChat
        storageKey="close-navigation"
        renderHeader={(props) => {
          header = props;
          return null;
        }}
        onNavigationChange={(_event, outcome) => {
          outcomes.push(outcome);
          if (outcome === "closed")
            window.dispatchEvent(
              new CustomEvent("agent-chat:open-thread", {
                detail: { threadId: "thread-2", prefill: "Final tab recovery" },
              }),
            );
        }}
      />
    );
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(chat());
    });
    await act(async () => root.render(chat()));
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId: "thread-2" },
        }),
      ),
    );
    await act(async () => header.closeTab("thread-1"));
    expect(outcomes).toEqual(["started"]);
    await act(async () => finishReplacement("thread-3"));
    expect(threadMocks.activeThreadId).toBe("thread-2");
    expect(header.tabs.some((tab) => tab.id === "thread-2")).toBe(true);
    expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
      "Final tab recovery",
    );
    await act(async () => finishLookup("opened"));
    expect(outcomes).toEqual(["started", "closed", "started", "selected"]);
  });

  it("preserves fresh work to the same destination accepted before closure publication", async () => {
    let finishLookup!: (result: "opened") => void;
    threadMocks.openThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    await mountNavigationSidebar();
    const cancellations: unknown[] = [];
    const recordResult = (event: Event) => {
      const result = (event as CustomEvent).detail;
      if (result.delivered === false) cancellations.push(result);
    };
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
    const reference = (label: string, insertMessageId: string) =>
      window.dispatchEvent(
        new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
          detail: {
            label,
            insertMessageId,
            refType: "file",
            refId: "/same-destination.md",
            slotKey: "document",
          },
        }),
      );
    try {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId: "thread-1" },
          }),
        );
        reference("Old same-tab reference", "same-destination-old-reference");
        dispatchSubmitChat({
          message: "Old same-tab draft",
          submit: false,
          openSidebar: false,
          submitMessageId: "same-destination-old-draft",
        });
      });
      await act(async () => {
        window.dispatchEvent(new CustomEvent("agent-chat:close-current-tab"));
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId: "thread-1" },
          }),
        );
        reference(
          "Fresh same-tab reference",
          "same-destination-fresh-reference",
        );
        dispatchSubmitChat({
          message: "Fresh same-tab draft",
          submit: false,
          openSidebar: false,
          submitMessageId: "same-destination-fresh-draft",
        });
      });
      const expectedCancellations = [
        {
          submitMessageId: "same-destination-old-draft",
          delivered: false,
          reason: "navigation-closed",
        },
      ];
      expect(cancellations).toEqual(expectedCancellations);
      expect(threadMocks.activeThreadId).toBe("thread-1");
      expect(chatHandleMocks.prefillMessage).toHaveBeenCalledTimes(1);
      expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
        "Fresh same-tab draft",
      );
      expect(assistantChatMockState.referenceDeliveries).toEqual([
        {
          threadId: "thread-1",
          context: expect.stringContaining("Fresh same-tab reference"),
        },
      ]);
      expect(
        assistantChatMockState.referenceDeliveries[0].context,
      ).not.toContain("Old same-tab reference");
      await act(async () => finishLookup("opened"));
      expect(cancellations).toEqual(expectedCancellations);
      expect(chatHandleMocks.prefillMessage).toHaveBeenCalledTimes(1);
      expect(assistantChatMockState.referenceDeliveries).toHaveLength(1);
    } finally {
      window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
    }
  });

  it.each([false, true])(
    "cancels dependent sidebar work for an unopened destination (recover=%s)",
    async (recover) => {
      let finishLookup!: (result: "opened") => void;
      threadMocks.openThread.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLookup = resolve;
          }),
      );
      await mountNavigationSidebar(false, false);
      threadMocks.createThread.mockImplementationOnce(async () => {
        threadMocks.switchThread("thread-3");
        return "thread-3";
      });
      const results: unknown[] = [];
      const recordResult = (event: Event) => {
        results.push((event as CustomEvent).detail);
        if (recover) {
          window.dispatchEvent(
            new CustomEvent("agent-chat:open-thread", {
              detail: { threadId: "thread-2" },
            }),
          );
          window.dispatchEvent(
            new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
              detail: {
                label: "Fresh recovery document",
                refType: "file",
                refId: "/recovery.md",
                slotKey: "document",
                insertMessageId: `bulk-close-recovery-reference-${recover}`,
              },
            }),
          );
          dispatchSubmitChat({
            message: "Fresh recovery draft",
            submit: false,
            openSidebar: false,
          });
        }
      };
      window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
      try {
        await act(async () => {
          requestAgentChatThreadOpen({ threadId: "thread-2" });
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(threadMocks.openThread).toHaveBeenCalledTimes(1);
        await act(async () => {
          window.dispatchEvent(
            new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
              detail: {
                label: "Cancelled document",
                refType: "file",
                refId: "/cancelled.md",
                slotKey: "document",
                insertMessageId: `bulk-close-reference-${recover}`,
              },
            }),
          );
          dispatchSubmitChat({
            message: "Cancelled dependent draft",
            submit: false,
            openSidebar: false,
            submitMessageId: `bulk-close-draft-${recover}`,
          });
        });
        await act(async () =>
          window.dispatchEvent(new CustomEvent("agent-chat:close-all-tabs")),
        );
        expect(results).toEqual([
          {
            submitMessageId: `bulk-close-draft-${recover}`,
            delivered: false,
            reason: "navigation-closed",
          },
        ]);
        await act(async () => finishLookup("opened"));
        expect(threadMocks.activeThreadId).toBe(
          recover ? "thread-2" : "thread-3",
        );
        if (recover) {
          expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
            "Fresh recovery draft",
          );
          expect(assistantChatMockState.referenceDeliveries).toContainEqual({
            threadId: "thread-2",
            context: expect.stringContaining("Fresh recovery document"),
          });
        }
        expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalledWith(
          "Cancelled dependent draft",
        );
        await act(async () => {
          requestAgentChatThreadOpen({ threadId: "thread-2" });
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => {
          dispatchSubmitChat({
            message: "Fresh navigation draft",
            submit: false,
            openSidebar: false,
          });
        });
        expect(threadMocks.activeThreadId).toBe("thread-2");
        expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
          "Fresh navigation draft",
        );
        expect(
          assistantChatMockState.referenceDeliveries.every(
            ({ context }) => !context.includes("Cancelled document"),
          ),
        ).toBe(true);
        expect(results).toEqual([
          {
            submitMessageId: `bulk-close-draft-${recover}`,
            delivered: false,
            reason: "navigation-closed",
          },
        ]);
      } finally {
        window.removeEventListener(
          AGENT_CHAT_SUBMIT_RESULT_EVENT,
          recordResult,
        );
      }
    },
  );

  it.each([false, true])(
    "commits navigation prefill before later drafts (mounted=%s)",
    async (mounted) => {
      await mountNavigationSidebar();
      if (mounted) {
        await act(async () => threadMocks.switchThread("thread-2"));
        await act(async () => threadMocks.switchThread("thread-1"));
      }
      chatHandleMocks.prefillMessage.mockClear();
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId: "thread-2", prefill: "Navigation prefill" },
          }),
        );
        dispatchSubmitChat({
          message: "Later draft",
          submit: false,
          openSidebar: false,
        });
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      expect(
        chatHandleMocks.prefillMessage.mock.calls.map(([message]) => message),
      ).toEqual(["Navigation prefill", "Later draft"]);
      expect(
        assistantChatMockState.referenceDeliveries.every(
          (delivery) => delivery.threadId === "thread-2",
        ),
      ).toBe(true);
    },
  );

  it.each(["attach", "close"] as const)(
    "retains navigation until its delayed handle can receive prefill (%s)",
    async (action) => {
      assistantChatMockState.deferredHandleThread = "thread-2";
      const sidebar = await mountNavigationSidebar();
      const results: unknown[] = [];
      const recordResult = (event: Event) =>
        results.push((event as CustomEvent).detail);
      window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
      try {
        await act(async () => {
          window.dispatchEvent(
            new CustomEvent("agent-chat:open-thread", {
              detail: {
                threadId: "thread-2",
                prefill: "Delayed navigation prefill",
              },
            }),
          );
          dispatchSubmitChat({
            message: "Delayed later draft",
            submit: false,
            openSidebar: false,
            submitMessageId: `delayed-${action}`,
          });
        });
        expect(threadMocks.activeThreadId).toBe("thread-2");
        expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
        if (action === "close") {
          await act(async () =>
            window.dispatchEvent(
              new CustomEvent("agent-chat:close-current-tab"),
            ),
          );
          expect(results).toContainEqual({
            submitMessageId: "delayed-close",
            delivered: false,
            reason: "navigation-closed",
          });
        }
        assistantChatMockState.deferredHandleThread = null;
        await act(async () => root.render(sidebar()));
        if (action === "attach")
          expect(
            chatHandleMocks.prefillMessage.mock.calls.map(
              ([message]) => message,
            ),
          ).toEqual(["Delayed navigation prefill", "Delayed later draft"]);
        else expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener(
          AGENT_CHAT_SUBMIT_RESULT_EVENT,
          recordResult,
        );
      }
    },
  );

  it("preserves navigation settlements added by a reentrant callback", async () => {
    threadMocks.threads.push(
      { ...threadMocks.threads[0], id: "thread-2" },
      { ...threadMocks.threads[0], id: "thread-3" },
    );
    const outcomes: string[] = [];
    const chat = () => (
      <MultiTabAssistantChat
        storageKey="bridge-test"
        onNavigationChange={(event, outcome) => {
          outcomes.push(`${event.type}:${outcome}`);
          if (event.type === "agent-chat:open-thread" && outcome === "selected")
            window.dispatchEvent(
              new CustomEvent("agent-task-open", {
                detail: {
                  threadId: "thread-3",
                  openRequestId: "reentrant-task",
                },
              }),
            );
        }}
      />
    );
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(chat());
    });
    await act(async () => root.render(chat()));
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId: "thread-2", openRequestId: "reentrant-thread" },
        }),
      ),
    );
    expect(threadMocks.activeThreadId).toBe("thread-3");
    expect(outcomes).toEqual([
      "agent-chat:open-thread:started",
      "agent-chat:open-thread:selected",
      "agent-task-open:started",
      "agent-task-open:selected",
    ]);
  });

  it.each(["missing", "unavailable", "superseded"] as const)(
    "keeps buffered navigation dependents attached through %s",
    async (outcome) => {
      let finishLookup!: (result: "opened" | "missing" | "unavailable") => void;
      threadMocks.openThread.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLookup = resolve;
          }),
      );
      await mountNavigationSidebar(true);
      const results: unknown[] = [];
      const recordResult = (event: Event) =>
        results.push((event as CustomEvent).detail);
      window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
      try {
        await act(async () => {
          requestAgentChatThreadOpen({ threadId: "thread-2" });
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(threadMocks.openThread).toHaveBeenCalledTimes(1);
        await act(async () => {
          window.dispatchEvent(
            new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
              detail: {
                label: "Buffered navigation document",
                refType: "file",
                refId: "/buffered.md",
                slotKey: "document",
                insertMessageId: `buffered-${outcome}`,
              },
            }),
          );
          dispatchSubmitChat({
            message: "Buffered dependent draft",
            submit: false,
            openSidebar: false,
            submitMessageId: `buffered-draft-${outcome}`,
          });
        });
        if (outcome === "superseded")
          await act(async () => threadMocks.switchThread("thread-2"));
        await act(async () =>
          finishLookup(outcome === "superseded" ? "opened" : outcome),
        );
        expect(results).toContainEqual({
          submitMessageId: `buffered-draft-${outcome}`,
          delivered: false,
          reason: `navigation-${outcome}`,
        });
        expect(assistantChatMockState.referenceDeliveries).toEqual([]);
      } finally {
        window.removeEventListener(
          AGENT_CHAT_SUBMIT_RESULT_EVENT,
          recordResult,
        );
      }
    },
  );

  it.each([
    { transport: "custom", create: false },
    { transport: "message", create: false },
    { transport: "custom", create: true },
  ])(
    "binds a cold $transport reference after earlier asynchronous navigation commits (create=$create)",
    async ({ transport, create }) => {
      assistantChatMockState.referenceProbe = true;
      assistantChatMockState.referenceDisabled = false;
      threadMocks.threads.push({ ...threadMocks.threads[0], id: "thread-2" });
      let finishLookup!: (result: "opened") => void;
      threadMocks.openThread.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishLookup = resolve;
          }),
      );
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const sidebar = () => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <AgentSidebar
              defaultOpen={false}
              storageKey="bridge-test"
              showMissingApiKeySetup={false}
            >
              <div>Content</div>
            </AgentSidebar>
          </MemoryRouter>
        </QueryClientProvider>
      );
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(sidebar());
      });
      if (create)
        threadMocks.createThread.mockImplementation(
          () =>
            new Promise((resolve) => {
              finishLookup = () => {
                threadMocks.switchThread("thread-2");
                resolve("thread-2");
              };
            }),
        );
      await act(async () => root.render(sidebar()));
      const detail = {
        label: "Destination document",
        refType: "file",
        refId: "/destination.md",
        slotKey: "document",
        insertMessageId: `cold-navigation-${transport}`,
      };
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId: "thread-2", newThread: create },
          }),
        );
        window.dispatchEvent(
          transport === "custom"
            ? new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, { detail })
            : new MessageEvent("message", {
                origin: window.location.origin,
                data: {
                  type: AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE,
                  data: detail,
                },
              }),
        );
        dispatchSubmitChat({
          message: "Use the destination document",
          submit: false,
          openSidebar: false,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(
        create ? threadMocks.createThread : threadMocks.openThread,
      ).toHaveBeenCalledWith("thread-2");
      expect(assistantChatMockState.referenceDeliveries).toEqual([]);
      expect(
        container.querySelector('[data-reference-thread="thread-1"]')
          ?.textContent,
      ).not.toContain("Destination document");
      await act(async () => finishLookup("opened"));
      expect(threadMocks.activeThreadId).toBe("thread-2");
      expect(assistantChatMockState.referenceDeliveries).toEqual([
        {
          threadId: "thread-2",
          context: expect.stringContaining("Destination document"),
        },
      ]);
    },
  );

  it.each(["missing", "unavailable", "failed", "skipped", "superseded"])(
    "cancels navigation-dependent work on %s and releases the next request",
    async (outcome) => {
      assistantChatMockState.referenceProbe = true;
      assistantChatMockState.referenceDisabled = false;
      threadMocks.threads.push({ ...threadMocks.threads[0], id: "thread-2" });
      let finishLookup!: () => void;
      threadMocks.openThread.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finishLookup = () =>
              outcome === "failed"
                ? reject(new Error("Fixture lookup failed"))
                : resolve(
                    outcome === "missing" || outcome === "unavailable"
                      ? outcome
                      : "opened",
                  );
          }),
      );
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const sidebar = () => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <AgentSidebar
              defaultOpen={false}
              storageKey="bridge-test"
              showMissingApiKeySetup={false}
            >
              <div>Content</div>
            </AgentSidebar>
          </MemoryRouter>
        </QueryClientProvider>
      );
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(sidebar());
      });
      const results: unknown[] = [];
      const recordResult = (event: Event) =>
        results.push((event as CustomEvent).detail);
      window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, recordResult);
      try {
        await act(async () => root.render(sidebar()));
        await act(async () => {
          window.dispatchEvent(
            new CustomEvent("agent-chat:open-thread", {
              detail: {
                threadId: "thread-2",
                onlyIfActiveThreadId:
                  outcome === "skipped" ? "another-thread" : undefined,
              },
            }),
          );
          window.dispatchEvent(
            new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
              detail: {
                label: "Failed navigation document",
                refType: "file",
                refId: "/failed.md",
                slotKey: "document",
                insertMessageId: `nav-${outcome}`,
              },
            }),
          );
          dispatchSubmitChat({
            message: "Dependent draft",
            submit: false,
            openSidebar: false,
            submitMessageId: `nav-dependent-${outcome}`,
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        if (outcome === "superseded")
          await act(async () => threadMocks.switchThread("thread-2"));
        if (outcome !== "skipped") await act(async () => finishLookup());
        expect(results).toContainEqual({
          submitMessageId: `nav-dependent-${outcome}`,
          delivered: false,
          reason: `navigation-${outcome}`,
        });
        expect(assistantChatMockState.referenceDeliveries).toEqual([]);
        threadMocks.openThread.mockReset();
        threadMocks.openThread.mockResolvedValue("opened");
        await act(async () =>
          window.dispatchEvent(
            new CustomEvent("agent-chat:open-thread", {
              detail: { threadId: "thread-2" },
            }),
          ),
        );
        expect(threadMocks.activeThreadId).toBe("thread-2");
      } finally {
        window.removeEventListener(
          AGENT_CHAT_SUBMIT_RESULT_EVENT,
          recordResult,
        );
      }
    },
  );

  it.each([
    [false, "agent-chat:open-thread"],
    [false, "agent-task-open"],
    [true, "agent-chat:open-thread"],
    [true, "agent-task-open"],
  ] as const)(
    "lets sidebar navigation supersede a held lookup (cold=%s, replacement=%s)",
    async (cold, replacement) => {
      assistantChatMockState.referenceProbe = true;
      assistantChatMockState.referenceDisabled = false;
      threadMocks.threads.push(
        { ...threadMocks.threads[0], id: "thread-2" },
        { ...threadMocks.threads[0], id: "thread-3" },
      );
      let finishLookup!: (result: "opened") => void;
      threadMocks.openThread.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLookup = resolve;
          }),
      );
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const sidebar = () => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <AgentSidebar
              defaultOpen={!cold}
              storageKey="bridge-test"
              showMissingApiKeySetup={false}
            >
              <div>Content</div>
            </AgentSidebar>
          </MemoryRouter>
        </QueryClientProvider>
      );
      threadMocks.switchThread.mockImplementation((id: string) => {
        threadMocks.activeThreadId = id;
        root.render(sidebar());
      });
      const results: Array<{
        submitMessageId: string;
        delivered: boolean;
        reason?: string;
      }> = [];
      const record = (event: Event) =>
        results.push((event as CustomEvent).detail);
      window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, record);
      const dependentId = `held-dependent-${cold}-${replacement}`;
      const openOriginal = () =>
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: {
              threadId: "thread-2",
              openRequestId: `held-${cold}-${replacement}`,
            },
          }),
        );
      try {
        await act(async () => root.render(sidebar()));
        if (!cold) await act(async () => openOriginal());
        await act(async () => {
          if (cold) openOriginal();
          window.dispatchEvent(
            new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
              detail: {
                label: "Original reference",
                refType: "file",
                refId: "/original.md",
                slotKey: "document",
                insertMessageId: `old-${cold}-${replacement}`,
              },
            }),
          );
          dispatchSubmitChat({
            message: "Original dependent draft",
            submit: false,
            openSidebar: false,
            submitMessageId: dependentId,
          });
          window.dispatchEvent(
            new CustomEvent(replacement, {
              detail: {
                threadId: "thread-3",
                openRequestId: `replacement-${cold}-${replacement}`,
              },
            }),
          );
          window.dispatchEvent(
            new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
              detail: {
                label: "Replacement reference",
                refType: "file",
                refId: "/replacement.md",
                slotKey: "document",
                insertMessageId: `new-${cold}-${replacement}`,
              },
            }),
          );
          dispatchSubmitChat({
            message: "Replacement dependent draft",
            submit: false,
            openSidebar: false,
          });
          await new Promise((resolve) => setTimeout(resolve, 75));
        });
        expect(threadMocks.activeThreadId).toBe("thread-3");
        expect(
          results.filter((result) => result.submitMessageId === dependentId),
        ).toEqual([
          {
            submitMessageId: dependentId,
            delivered: false,
            reason: "navigation-superseded",
          },
        ]);
        expect(assistantChatMockState.referenceDeliveries).toEqual([
          {
            threadId: "thread-3",
            context: expect.stringContaining("Replacement reference"),
          },
        ]);
        expect(
          assistantChatMockState.referenceDeliveries[0].context,
        ).not.toContain("Original reference");
        await act(async () => finishLookup("opened"));
        expect(threadMocks.activeThreadId).toBe("thread-3");
        expect(assistantChatMockState.referenceDeliveries).toHaveLength(1);
        expect(
          results.filter((result) => result.submitMessageId === dependentId),
        ).toHaveLength(1);
      } finally {
        window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, record);
      }
    },
  );

  it.each([false, true])(
    "rejects queued sends when the panel unmounts (scheduled=%s)",
    async (scheduled) => {
      assistantChatMockState.deferredHandleThread = "thread-2";
      const chat = () => <MultiTabAssistantChat storageKey="bridge-test" />;
      const pendingId = `unmount-pending-${scheduled}`;
      const results: Array<{ submitMessageId: string; delivered: boolean }> =
        [];
      const record = (event: Event) =>
        results.push((event as CustomEvent).detail);
      window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, record);
      await act(async () => root.render(chat()));
      await act(async () =>
        dispatchSubmitChat({
          message: "Queued before unmount",
          submit: false,
          targetTabId: "thread-2",
          submitMessageId: pendingId,
        }),
      );
      vi.useFakeTimers();
      try {
        if (scheduled) {
          assistantChatMockState.deferredHandleThread = null;
          await act(async () => root.render(chat()));
        }
        await act(async () =>
          dispatchSubmitChat({
            message: "Already handed off",
            submit: false,
            targetTabId: "thread-1",
            submitMessageId: `unmount-delivered-${scheduled}`,
          }),
        );
        await act(async () => root.render(null));
        expect(
          results.filter((result) => result.submitMessageId === pendingId),
        ).toEqual([
          {
            submitMessageId: pendingId,
            delivered: false,
            reason: "panel-unmounted",
          },
        ]);
        await act(async () => vi.advanceTimersByTimeAsync(100));
        expect(chatHandleMocks.prefillMessage).toHaveBeenCalledExactlyOnceWith(
          "Already handed off",
        );
        expect(
          results.filter((result) => result.submitMessageId === pendingId),
        ).toHaveLength(1);
        expect(
          results.filter(
            (result) =>
              result.submitMessageId === `unmount-delivered-${scheduled}` &&
              !result.delivered,
          ),
        ).toEqual([]);
      } finally {
        vi.useRealTimers();
        window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, record);
      }
    },
  );

  it("starts cold thread navigation without a ready composer and preserves explicit targets", async () => {
    assistantChatMockState.referenceProbe = true;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    threadMocks.threads.push({
      ...threadMocks.threads[0],
      id: "thread-2",
      title: "Other thread",
    });
    let finishLookup!: (result: "opened") => void;
    threadMocks.openThread.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    const sidebar = () => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentSidebar
            defaultOpen={false}
            storageKey="bridge-test"
            showMissingApiKeySetup={false}
          >
            <div>Content</div>
          </AgentSidebar>
        </MemoryRouter>
      </QueryClientProvider>
    );
    threadMocks.switchThread.mockImplementation((id: string) => {
      threadMocks.activeThreadId = id;
      root.render(sidebar());
    });
    await act(async () => root.render(sidebar()));
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId: "thread-2" },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(threadMocks.openThread).toHaveBeenCalledWith("thread-2");
    expect(threadMocks.activeThreadId).toBe("thread-1");
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "thread-1" },
        }),
      ),
    );
    expect(
      container.querySelector(".agent-sidebar-panel-inner"),
    ).not.toBeNull();
    expect(
      container.querySelector(".tiptap")?.getAttribute("contenteditable"),
    ).toBe("false");
    await act(async () => finishLookup("opened"));
    expect(threadMocks.activeThreadId).toBe("thread-2");
    await act(async () =>
      dispatchSubmitChat({
        message: "Target the original",
        targetTabId: "thread-1",
        submit: false,
        openSidebar: false,
      }),
    );
    expect(assistantChatMockState.referenceDeliveries).toEqual([
      { threadId: "thread-1", context: expect.any(String) },
    ]);
  });

  it("receives queued commands when the real client-only panel reports ready", async () => {
    act(() => root.unmount());
    root = createRoot(container);
    chatHandleMocks.prefillMessage.mockClear();
    const onOpenSettings = vi.fn();
    const onReadyChange = vi.fn((ready: boolean) => {
      if (ready) {
        window.dispatchEvent(
          new CustomEvent("agent-panel:set-mode", { detail: { mode: "cli" } }),
        );
        window.dispatchEvent(
          new CustomEvent("agent-panel:open-settings", {
            detail: { section: "agent" },
          }),
        );
        dispatchSubmitChat({
          message: "Queued draft",
          submit: false,
          openSidebar: false,
        });
      }
    });
    const panel = (key: string) => (
      <MemoryRouter>
        <AgentSidebarPanel
          key={key}
          storageKey="bridge-test"
          showHeader={false}
          renderCliTab={() => <div>Terminal</div>}
          onOpenSettings={onOpenSettings}
          onReadyChange={onReadyChange}
        />
      </MemoryRouter>
    );
    await act(async () => {
      root.render(panel("initial"));
      await Promise.resolve();
    });
    expect(chatHandleMocks.prefillMessage).toHaveBeenCalledExactlyOnceWith(
      "Queued draft",
    );
    expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith("agent");
    expect(localStorage.getItem("agent-native-panel-mode:bridge-test")).toBe(
      "cli",
    );
    onReadyChange.mockClear();
    chatHandleMocks.prefillMessage.mockClear();
    await act(async () => root.render(panel("replacement")));
    expect(onReadyChange.mock.calls[0]).toEqual([false]);
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
    expect(chatHandleMocks.prefillMessage).toHaveBeenCalledExactlyOnceWith(
      "Queued draft",
    );
    act(() => root.unmount());
    expect(onReadyChange).toHaveBeenLastCalledWith(false);
    root = createRoot(container);
  });

  it("keeps thread saves metadata-only for built-in, runtime, and custom transports", async () => {
    const snapshot = {
      threadData: JSON.stringify({ messages: [{ id: "message-1" }] }),
      title: "Saved chat",
      preview: "Latest request",
      messageCount: 1,
      titleSource: "fallback" as const,
    };
    window.history.replaceState(null, "", "/");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat storageKey="bridge-test" threadUrlSync />,
      );
      await Promise.resolve();
    });

    act(() => assistantChatMockState.onSaveThread?.("thread-1", snapshot));

    expect(threadMocks.saveThreadData).toHaveBeenLastCalledWith("thread-1", {
      ...snapshot,
      threadData: "",
    });
    expect(window.location.search).toBe("?thread=thread-1");

    const createTransport = (() => ({}) as never) as NonNullable<
      MultiTabAssistantChatProps["createTransport"]
    >;
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          threadUrlSync
          createTransport={createTransport}
        />,
      );
      await Promise.resolve();
    });

    act(() => assistantChatMockState.onSaveThread?.("thread-1", snapshot));

    expect(threadMocks.saveThreadData).toHaveBeenLastCalledWith("thread-1", {
      ...snapshot,
      threadData: "",
    });
    expect(window.location.search).toBe("?thread=thread-1");

    const runtime = {} as NonNullable<MultiTabAssistantChatProps["runtime"]>;
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          threadUrlSync
          runtime={runtime}
        />,
      );
      await Promise.resolve();
    });

    act(() => assistantChatMockState.onSaveThread?.("thread-1", snapshot));

    expect(threadMocks.saveThreadData).toHaveBeenLastCalledWith("thread-1", {
      ...snapshot,
      threadData: "",
    });
    expect(window.location.search).toBe("?thread=thread-1");
  });

  it("persists a sanitized prompt title when title generation is unavailable", async () => {
    threadMocks.generateTitle.mockResolvedValueOnce(null);
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="title-fallback" />);
      await Promise.resolve();
    });

    const message =
      'Summarize @[the sprint|resource:123]\n<context data-agentkit-context-encoding="entities-v1">Private context</context>';
    await act(async () => {
      assistantChatMockState.onGenerateTitle?.("thread-1", message, {});
      await Promise.resolve();
    });

    expect(threadMocks.saveThreadData).toHaveBeenCalledWith("thread-1", {
      threadData: "",
      title: "Summarize @the sprint",
      preview: message.slice(0, 120),
      titleSource: "fallback",
    });
  });

  it("prefills the active composer with hidden context when submit is false", () => {
    act(() => {
      dispatchSubmitChat({
        message: "Review this before sending",
        context: "Selected rows: a, b",
        submit: false,
        openSidebar: true,
      });
    });

    expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
      "Review this before sending",
    );
    expect(chatHandleMocks.setComposerContextItem).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "agent-chat-prefill-context",
        title: "Active app context",
        context: "Selected rows: a, b",
      }),
      { focus: false, threadScoped: true },
    );
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
  });

  it("titles a context prefill with the contextLabel it was given", () => {
    act(() => {
      dispatchSubmitChat({
        message: "Tell me more",
        context: '{"movieId":969681}',
        contextLabel: "Spider-Man: Brand New Day",
        submit: false,
      });
    });

    expect(chatHandleMocks.setComposerContextItem).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "agent-chat-prefill-context",
        title: "Spider-Man: Brand New Day",
        context: '{"movieId":969681}',
      }),
      { focus: false, threadScoped: true },
    );
  });

  it("refuses a prefill the composer cannot hold alongside its current context", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const results: unknown[] = [];
    const onResult = (event: Event) =>
      results.push((event as CustomEvent).detail);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
    chatHandleMocks.canStageComposerContextItem.mockReturnValueOnce(false);
    act(() => {
      dispatchSubmitChat({
        message: "Review this",
        context: "Selected rows: a, b",
        submit: false,
        openSidebar: true,
        submitMessageId: "refused-prefill",
      });
    });
    window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);

    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
    expect(chatHandleMocks.setComposerContextItem).not.toHaveBeenCalled();
    expect(results).toContainEqual({
      submitMessageId: "refused-prefill",
      delivered: false,
      reason: "context-too-large",
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("alongside the composer's existing context"),
    );
    consoleError.mockRestore();
  });

  it("reports a prefill whose staging check cannot run yet as composer-not-ready", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const results: unknown[] = [];
    const onResult = (event: Event) =>
      results.push((event as CustomEvent).detail);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
    chatHandleMocks.canStageComposerContextItem.mockImplementationOnce(() => {
      throw new ComposerContextError("not-ready");
    });
    act(() => {
      dispatchSubmitChat({
        message: "Review this",
        context: "Selected rows: a, b",
        submit: false,
        openSidebar: true,
        submitMessageId: "pending-prefill",
      });
    });
    window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);

    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
    expect(results).toContainEqual({
      submitMessageId: "pending-prefill",
      delivered: false,
      reason: "composer-not-ready",
    });
    consoleError.mockRestore();
  });

  it.each([false, true])(
    "keeps later deliveries behind context persistence (submit=%s)",
    async (submit) => {
      const persisted = Promise.withResolvers<{ stagingId: string }>();
      chatHandleMocks.setComposerContextItem.mockReturnValueOnce(
        persisted.promise,
      );
      vi.useFakeTimers();
      try {
        await act(async () =>
          dispatchSubmitChat({
            message: "Earlier draft",
            context: "Selected rows",
            submit: false,
            targetTabId: "thread-1",
          }),
        );
        await act(async () =>
          dispatchSubmitChat({
            message: "Later delivery",
            submit,
            targetTabId: "thread-1",
          }),
        );
        expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
        expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
        await act(async () => {
          persisted.resolve({ stagingId: "prefill-staging-id-7" });
          await persisted.promise;
          await vi.advanceTimersByTimeAsync(100);
        });
        expect(chatHandleMocks.prefillMessage.mock.calls[0]?.[0]).toBe(
          "Earlier draft",
        );
        const later = submit
          ? chatHandleMocks.sendMessage
          : chatHandleMocks.prefillMessage;
        expect(later.mock.calls.at(-1)?.[0]).toBe("Later delivery");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("cancels a context prefill still persisting when the panel unmounts", async () => {
    const persisted = Promise.withResolvers<{ stagingId: string }>();
    const results: unknown[] = [];
    const onResult = (event: Event) =>
      results.push((event as CustomEvent).detail);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
    chatHandleMocks.setComposerContextItem.mockReturnValueOnce(
      persisted.promise,
    );
    try {
      await act(async () =>
        dispatchSubmitChat({
          message: "Undelivered draft",
          context: "Selected rows",
          submit: false,
          submitMessageId: "persisting-unmount",
        }),
      );
      act(() => root.unmount());
      root = createRoot(container);
      expect(results).toEqual([
        {
          submitMessageId: "persisting-unmount",
          delivered: false,
          reason: "panel-unmounted",
        },
      ]);
      await act(async () => {
        persisted.resolve({ stagingId: "prefill-staging-id-7" });
        await persisted.promise;
      });
      expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
      expect(chatHandleMocks.removeComposerContextItem).toHaveBeenCalledWith(
        "agent-chat-prefill-context",
        { threadScoped: true, stagingId: "prefill-staging-id-7" },
      );
      expect(results).toHaveLength(1);
    } finally {
      window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
    }
  });

  it.each(["close", "unmount"])(
    "does not cancel a delivered prefill when its receipt triggers %s",
    async (action) => {
      const submitMessageId = `persisted-receipt-${action}`;
      if (action === "close") {
        threadMocks.threads.push({
          ...threadMocks.threads[0],
          id: "thread-2",
          title: "Other thread",
        });
        window.localStorage.setItem(
          openTabsStorageKey("bridge-test"),
          JSON.stringify(["thread-1", "thread-2"]),
        );
        act(() => root.unmount());
        root = createRoot(container);
        await act(async () =>
          root.render(<MultiTabAssistantChat storageKey="bridge-test" />),
        );
      }
      const persisted = Promise.withResolvers<{ stagingId: string }>();
      const results: unknown[] = [];
      const onResult = (event: Event) => {
        const result = (event as CustomEvent).detail;
        results.push(result);
        if (result.delivered) {
          if (action === "close")
            window.dispatchEvent(
              new CustomEvent("agent-chat:close-current-tab"),
            );
          else {
            root.unmount();
            root = createRoot(container);
          }
        }
      };
      window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
      chatHandleMocks.setComposerContextItem.mockReturnValueOnce(
        persisted.promise,
      );
      try {
        await act(async () =>
          dispatchSubmitChat({
            message: "Delivered draft",
            context: "Selected rows",
            submit: false,
            submitMessageId,
          }),
        );
        await act(async () => {
          persisted.resolve({ stagingId: "prefill-staging-id-7" });
          await persisted.promise;
        });
        expect(chatHandleMocks.prefillMessage).toHaveBeenCalledExactlyOnceWith(
          "Delivered draft",
        );
        expect(results).toEqual([{ submitMessageId, delivered: true }]);
      } finally {
        window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
      }
    },
  );

  it.each(["close", "unmount"])(
    "preserves cancellation when context persistence rejects after %s",
    async (action) => {
      const submitMessageId = `rejected-context-${action}`;
      if (action === "close") {
        threadMocks.threads.push({
          ...threadMocks.threads[0],
          id: "thread-2",
          title: "Other thread",
        });
        window.localStorage.setItem(
          openTabsStorageKey("bridge-test"),
          JSON.stringify(["thread-1", "thread-2"]),
        );
        act(() => root.unmount());
        root = createRoot(container);
        await act(async () =>
          root.render(<MultiTabAssistantChat storageKey="bridge-test" />),
        );
      }
      const persisted = Promise.withResolvers<{ stagingId: string }>();
      const results: unknown[] = [];
      const onResult = (event: Event) =>
        results.push((event as CustomEvent).detail);
      window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
      chatHandleMocks.setComposerContextItem.mockReturnValueOnce(
        persisted.promise,
      );
      try {
        await act(async () =>
          dispatchSubmitChat({
            message: "Cancelled draft",
            context: "Selected rows",
            submit: false,
            submitMessageId,
          }),
        );
        await act(async () => {
          if (action === "close")
            window.dispatchEvent(
              new CustomEvent("agent-chat:close-current-tab"),
            );
          else {
            root.unmount();
            root = createRoot(container);
          }
        });
        expect(results).toEqual([
          {
            submitMessageId,
            delivered: false,
            reason:
              action === "close" ? "target-tab-closed" : "panel-unmounted",
          },
        ]);
        await act(async () => {
          persisted.reject(new Error("Context write failed"));
          await expect(persisted.promise).rejects.toThrow(
            "Context write failed",
          );
        });
        expect(results).toHaveLength(1);
        expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
      }
    },
  );

  it("releases the delivery lane when a queued send throws synchronously", async () => {
    const persisted = Promise.withResolvers<{ stagingId: string }>();
    chatHandleMocks.setComposerContextItem.mockReturnValueOnce(
      persisted.promise,
    );
    chatHandleMocks.sendMessage.mockImplementationOnce(() => {
      throw new Error("Synchronous send failure");
    });
    vi.useFakeTimers();
    try {
      await act(async () => {
        dispatchSubmitChat({
          message: "Earlier draft",
          context: "Selected rows",
          submit: false,
        });
        dispatchSubmitChat({ message: "Throwing send", submit: true });
        dispatchSubmitChat({ message: "Later send", submit: true });
        persisted.resolve({ stagingId: "prefill-staging-id-7" });
        await persisted.promise;
      });
      await expect(
        act(async () => vi.advanceTimersByTimeAsync(50)),
      ).rejects.toThrow("Synchronous send failure");
      await act(async () => vi.advanceTimersByTimeAsync(50));
      expect(
        chatHandleMocks.sendMessage.mock.calls.map(([message]) => message),
      ).toEqual(["Throwing send", "Later send"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for thread context persistence before prefilling", async () => {
    const persisted = Promise.withResolvers<void>();
    const results: unknown[] = [];
    const onResult = (event: Event) =>
      results.push((event as CustomEvent).detail);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
    chatHandleMocks.setComposerContextItem.mockReturnValueOnce(
      persisted.promise,
    );

    act(() => {
      dispatchSubmitChat({
        message: "Review this before sending",
        context: "Selected rows: a, b",
        submit: false,
        submitMessageId: "prefill-persisted",
      });
    });

    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
    await act(async () => {
      persisted.resolve();
      await persisted.promise;
    });

    expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
      "Review this before sending",
    );
    expect(results).toEqual([
      { submitMessageId: "prefill-persisted", delivered: true },
    ]);
    window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
  });

  it("removes persisted thread context when its prefill is cancelled", async () => {
    const persisted = Promise.withResolvers<{ stagingId: string }>();
    chatHandleMocks.setComposerContextItem.mockReturnValueOnce(
      persisted.promise,
    );

    act(() => {
      dispatchSubmitChat({
        message: "Review this before sending",
        context: "Selected rows: a, b",
        submit: false,
        submitMessageId: "prefill-cancelled-after-persist",
      });
    });
    cancelAgentChatSubmit("prefill-cancelled-after-persist");

    await act(async () => {
      persisted.resolve({ stagingId: "staged-7" });
      await persisted.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
    expect(chatHandleMocks.removeComposerContextItem).toHaveBeenCalledWith(
      "agent-chat-prefill-context",
      { threadScoped: true, stagingId: "staged-7" },
    );
  });

  it("does not remove by key alone when the staged prefill's identity is unknown", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const persisted = Promise.withResolvers<undefined>();
    chatHandleMocks.setComposerContextItem.mockReturnValueOnce(
      persisted.promise,
    );

    act(() => {
      dispatchSubmitChat({
        message: "Review this before sending",
        context: "Selected rows: a, b",
        submit: false,
        submitMessageId: "prefill-cancelled-without-identity",
      });
    });
    cancelAgentChatSubmit("prefill-cancelled-without-identity");

    await act(async () => {
      persisted.resolve(undefined);
      await persisted.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatHandleMocks.removeComposerContextItem).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Could not identify the staged prefill context"),
    );
    consoleError.mockRestore();
  });

  it("reports a failed context write without saving the draft", async () => {
    const results: unknown[] = [];
    const onResult = (event: Event) =>
      results.push((event as CustomEvent).detail);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
    chatHandleMocks.setComposerContextItem.mockImplementationOnce(() =>
      Promise.reject(new Error("offline")),
    );

    act(() => {
      dispatchSubmitChat({
        message: "Review this before sending",
        context: "Selected rows: a, b",
        submit: false,
        submitMessageId: "prefill-persist-failed",
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
    expect(results).toEqual([
      {
        submitMessageId: "prefill-persist-failed",
        delivered: false,
        reason: "context-persistence-failed",
      },
    ]);
    window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
  });

  it("replaces the staged context when prefilled again", async () => {
    await act(async () => {
      dispatchSubmitChat({
        message: "Review this before sending",
        context: "Selected rows: a, b",
        submit: false,
        openSidebar: true,
      });
    });
    await act(async () => {
      dispatchSubmitChat({
        message: "Review this before sending",
        context: "Selected rows: c, d",
        submit: false,
        openSidebar: true,
      });
    });

    const calls = chatHandleMocks.setComposerContextItem.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0].key).toBe("agent-chat-prefill-context");
    expect(calls[1]?.[0].key).toBe(calls[0]?.[0].key);
    expect(calls[1]?.[0].context).toBe("Selected rows: c, d");
    expect(calls[0]?.[1]).toEqual({ focus: false, threadScoped: true });
    expect(calls[1]?.[1]).toEqual({ focus: false, threadScoped: true });
  });

  it("uses the current context namespace for a prefilled context", async () => {
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{
            type: "desktop-app",
            id: "calendar",
            contextKey: "desktop-app:calendar",
          }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{
            type: "desktop-app",
            id: "mail",
            contextKey: "desktop-app:mail",
          }}
        />,
      );
      await Promise.resolve();
    });

    act(() => {
      dispatchSubmitChat({
        message: "Review this before sending",
        context: "Selected message: hello",
        submit: false,
      });
    });

    expect(chatHandleMocks.setComposerContextItem).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "Selected message: hello",
        contextNamespace: "desktop-app:mail",
      }),
      { focus: false, threadScoped: true },
    );
  });

  it("reports a rejected queued submission instead of leaving it unhandled", async () => {
    const results: unknown[] = [];
    const onResult = (event: Event) =>
      results.push((event as CustomEvent).detail);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
    chatHandleMocks.sendMessage.mockRejectedValueOnce(
      new Error("attachment upload failed"),
    );

    act(() => {
      dispatchSubmitChat({
        message: "Create a deck",
        submitMessageId: "failed-send",
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, onResult);
    expect(results).toContainEqual({
      submitMessageId: "failed-send",
      delivered: false,
      reason: "submission-failed",
    });
  });

  it("routes a correlated continuation to its original tab after focus changes", async () => {
    const generationThread = {
      id: "generation-thread",
      title: "Generation thread",
      preview: "Create a presentation",
      messageCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scope: null,
    };
    threadMocks.activeThreadId = "other-thread";
    threadMocks.threads = [...threadMocks.threads, generationThread];
    window.localStorage.setItem(
      openTabsStorageKey("bridge-test"),
      JSON.stringify(["thread-1", "generation-thread", "other-thread"]),
    );
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "other-thread",
        title: "Other thread",
        preview: "Unrelated chat",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
      await Promise.resolve();
    });
    chatHandleMocks.sendMessage.mockClear();
    threadMocks.switchThread.mockClear();

    const targetEvents: Event[] = [];
    const onTarget = (event: Event) => targetEvents.push(event);
    window.addEventListener("agentNative.chatSubmitTarget", onTarget);
    act(() => {
      dispatchSubmitChat({
        message: "Here are my answers.",
        context: "Continue deck generation.",
        submit: true,
        targetTabId: "generation-thread",
        submitMessageId: "guided-answer-submit",
      });
    });

    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      'Here are my answers.\n\n<context data-agentkit-context-encoding="entities-v1">\nContinue deck generation.\n</context>',
      undefined,
      { submitMessageId: "guided-answer-submit" },
    );
    expect((targetEvents[0] as CustomEvent).detail).toEqual({
      submitMessageId: "guided-answer-submit",
      tabId: "generation-thread",
    });
    expect(threadMocks.switchThread).not.toHaveBeenCalled();
    window.removeEventListener("agentNative.chatSubmitTarget", onTarget);
  });

  it("preserves a host-disabled composer and its explanation after model loading", async () => {
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          composerDisabled
          composerDisabledPlaceholder="Connect an integration first"
        />,
      );
      await Promise.resolve();
    });
    const composer = container.querySelector('[data-testid="assistant-chat"]');
    expect(composer?.getAttribute("data-composer-disabled")).toBe("true");
    expect(composer?.getAttribute("data-disabled-placeholder")).toBe(
      "Connect an integration first",
    );
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          composerDisabled={false}
        />,
      );
    });
    expect(composer?.getAttribute("data-composer-disabled")).toBe("false");
    expect(composer?.getAttribute("data-disabled-placeholder")).toBeNull();
  });

  it("deactivates the selected composer while chat content is hidden", async () => {
    await act(async () =>
      root.render(
        <MultiTabAssistantChat storageKey="bridge-test" contentHidden />,
      ),
    );
    const composer = container.querySelector('[data-testid="assistant-chat"]');
    expect(composer?.getAttribute("data-composer-active")).toBe("false");
    expect(composer?.getAttribute("data-reference-target")).toBe("true");
    await act(async () =>
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          contentHidden={false}
        />,
      ),
    );
    expect(composer?.getAttribute("data-composer-active")).toBe("true");
  });

  it("reopens a closed target tab before delivering a continuation", async () => {
    const generationThread = {
      id: "closed-generation-thread",
      title: "Generation thread",
      preview: "Create a presentation",
      messageCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scope: null,
    };
    threadMocks.threads = [...threadMocks.threads, generationThread];
    threadMocks.switchThread.mockImplementation((threadId: string) => {
      threadMocks.activeThreadId = threadId;
    });
    threadMocks.switchThread.mockClear();
    chatHandleMocks.sendMessage.mockClear();

    act(() => {
      dispatchSubmitChat({
        message: "Continue the deck generation.",
        submit: true,
        targetTabId: generationThread.id,
        submitMessageId: "closed-generation-submit",
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(threadMocks.switchThread).toHaveBeenCalledWith(generationThread.id);
    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Continue the deck generation.",
      undefined,
      { submitMessageId: "closed-generation-submit" },
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(openTabsStorageKey("bridge-test")) ?? "[]",
      ),
    ).toContain(generationThread.id);
  });

  it("activates an open targeted tab when it has no mounted chat ref", async () => {
    const generationThread = {
      id: "unmounted-generation-thread",
      title: "Generation thread",
      preview: "Create a presentation",
      messageCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scope: null,
    };
    threadMocks.threads = [...threadMocks.threads, generationThread];
    threadMocks.switchThread.mockImplementation(() => undefined);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-task-open", {
          detail: {
            threadId: generationThread.id,
          },
        }),
      );
    });
    expect(threadMocks.activeThreadId).toBe("thread-1");
    expect(
      container.querySelectorAll('[data-testid="assistant-chat"]'),
    ).toHaveLength(1);

    threadMocks.switchThread.mockImplementation((threadId: string) => {
      threadMocks.activeThreadId = threadId;
    });
    threadMocks.switchThread.mockClear();
    chatHandleMocks.sendMessage.mockClear();
    act(() => {
      dispatchSubmitChat({
        message: "Continue the deck generation.",
        submit: true,
        targetTabId: generationThread.id,
        submitMessageId: "unmounted-generation-submit",
      });
    });
    expect(threadMocks.switchThread).toHaveBeenCalledWith(generationThread.id);

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
      await Promise.resolve();
    });
    expect(
      container.querySelectorAll('[data-testid="assistant-chat"]'),
    ).toHaveLength(2);
  });

  it("defaults effort to high", () => {
    expect(
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-reasoning-effort"),
    ).toBe("high");
  });

  it("defaults a fresh chat to a configured model group", async () => {
    const view = await mountWithCatalog(
      [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: ["gpt-5-6-luna"],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        },
      ],
      [],
      true,
    );

    expect(view.engineOf()).toBe("builder");
    await view.cleanup();
  });

  it("offers a provider's own key next to Builder.io", async () => {
    const view = await mountWithCatalog(
      [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: ["gpt-5-6-luna"],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        },
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-5.6-luna"],
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
      ],
      ["OPENAI_API_KEY"],
      true,
    );

    expect(view.catalogOf()).toBe("builder:true,ai-sdk:openai:true");
    await view.cleanup();
  });

  it("keeps a fresh chat editable and preserves the host send gate", async () => {
    const engines = [
      {
        name: "builder",
        label: "Builder.io Gateway",
        supportedModels: ["gpt-5-6-luna"],
        requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
      },
    ];
    stubCatalog(engines, [], true);
    let resolveEngineList!: (value: unknown) => void;
    modelCatalogMocks.load = () =>
      new Promise((resolve) => (resolveEngineList = resolve));

    const el = document.createElement("div");
    document.body.appendChild(el);
    const localRoot = createRoot(el);
    act(() => {
      localRoot.render(
        <MultiTabAssistantChat
          storageKey="pending-catalog"
          composerSubmissionDisabled
        />,
      );
    });

    expect(
      el
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-composer-disabled"),
    ).toBe("false");
    expect(
      el
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-composer-submission-disabled"),
    ).toBe("true");

    await act(async () => {
      resolveEngineList({
        state: "available",
        groups: [],
        defaultModel: "gpt-5-6-luna",
        loadLiveGroups: async () => null,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    modelCatalogMocks.load = null;

    expect(
      el
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-composer-disabled"),
    ).toBe("false");
    expect(
      el
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-composer-submission-disabled"),
    ).toBe("true");

    await act(async () => localRoot.unmount());
    el.remove();
  });

  it("applies a submitted model override before the engine list loads", () => {
    act(() => {
      dispatchSubmitChat({
        message: "Generate design for hi page",
        submit: true,
        model: "gpt-5-6-luna",
        engine: "builder",
        effort: "medium",
      });
    });

    const chat = container.querySelector("[data-testid='assistant-chat']");
    expect(chat?.getAttribute("data-selected-model")).toBe("gpt-5-6-luna");
    expect(chat?.getAttribute("data-selected-engine")).toBe("builder");
  });

  it("treats a blank submitted engine as absent rather than as a value", () => {
    act(() => {
      dispatchSubmitChat({
        message: "Generate design for hi page",
        submit: true,
        model: "gpt-5-6-luna",
        engine: "",
      });
    });

    const chat = container.querySelector("[data-testid='assistant-chat']");
    expect(chat?.getAttribute("data-selected-model")).toBe("gpt-5-6-luna");
    expect(chat?.getAttribute("data-selected-engine")).toBeNull();
  });

  it("resolves an engine from the catalog when the submit carries none", async () => {
    const view = await mountWithCatalog(ANTHROPIC_ENGINES, [
      "ANTHROPIC_API_KEY",
    ]);
    await act(async () => {
      dispatchSubmitChat({
        message: "m",
        submit: true,
        model: "claude-sonnet-5",
      });
      await Promise.resolve();
    });
    expect(view.engineOf()).toBe("anthropic");
    await view.cleanup();
  });

  it("reports the active thread's exact engine to its resource panel", async () => {
    const storageKey = "resources-engine-context";
    const engines = [
      {
        name: "anthropic",
        label: "Anthropic",
        defaultModel: "claude-sonnet-5-5",
        supportedModels: ["claude-sonnet-5-5", "claude-fable-5"],
        requiredEnvVars: ["ANTHROPIC_API_KEY"],
      },
    ];
    stubCatalog(engines, ["ANTHROPIC_API_KEY"]);
    window.localStorage.setItem(
      chatModelSelectionStorageKey(storageKey),
      JSON.stringify({ model: "claude-sonnet-5-5", engine: "anthropic" }),
    );

    let selectedEngine: {
      name: string;
      supportedModels: readonly string[];
    } | null = null;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const localRoot = createRoot(el);
    await act(async () => {
      localRoot.render(
        <MultiTabAssistantChat
          storageKey={storageKey}
          onActiveModelEngineChange={(engine) => {
            selectedEngine = engine;
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(selectedEngine).toMatchObject({
      name: "anthropic",
      supportedModels: ["claude-sonnet-5-5", "claude-fable-5"],
    });
    await act(async () => localRoot.unmount());
    el.remove();
  });

  it("keeps the last model readiness when status refresh is unavailable", async () => {
    const view = await mountWithCatalog(ANTHROPIC_ENGINES, [
      "ANTHROPIC_API_KEY",
    ]);
    const initialCatalog = view.catalogOf();
    expect(initialCatalog).toContain("anthropic:true");
    expect(initialCatalog).toContain("ai-sdk:openai:false");

    invalidateClientStatusRequests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("down"))),
    );
    await act(async () => {
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.catalogOf()).toBe(initialCatalog);
    await view.cleanup();
  });

  it("keeps a host-supplied model catalog instead of the discovered one", async () => {
    stubCatalog(ANTHROPIC_ENGINES, ["ANTHROPIC_API_KEY"]);
    const storageKey = "host-catalog-test";
    window.localStorage.setItem(
      chatModelSelectionStorageKey(storageKey),
      JSON.stringify({ model: "host-model", engine: "anthropic" }),
    );
    let activeEngine: {
      name: string;
      defaultModel: string;
      supportedModels: readonly string[];
      selectableModels?: readonly string[];
    } | null = null;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const localRoot = createRoot(el);
    await act(async () => {
      localRoot.render(
        <MultiTabAssistantChat
          storageKey={storageKey}
          onActiveModelEngineChange={(engine) => {
            activeEngine = engine;
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(activeEngine).toMatchObject({
      name: "anthropic",
      supportedModels: ["claude-sonnet-5"],
    });

    await act(async () => {
      localRoot.render(
        <MultiTabAssistantChat
          storageKey={storageKey}
          availableModels={[
            {
              engine: "anthropic",
              label: "Host Anthropic",
              models: ["host-model", "host-model-2"],
              configured: true,
            },
          ]}
          onActiveModelEngineChange={(engine) => {
            activeEngine = engine;
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      el
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-model-catalog"),
    ).toBe("anthropic:true");
    expect(activeEngine).toMatchObject({
      name: "anthropic",
      defaultModel: "host-model",
      supportedModels: ["host-model", "host-model-2"],
      selectableModels: ["host-model", "host-model-2"],
    });

    await act(async () => localRoot.unmount());
    el.remove();
  });

  it("routes host model catalog retries to the host", async () => {
    const onRetryModelList = vi.fn();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const localRoot = createRoot(el);
    await act(async () => {
      localRoot.render(
        <MultiTabAssistantChat
          storageKey="host-catalog-retry-test"
          availableModels={[]}
          modelListError
          onRetryModelList={onRetryModelList}
        />,
      );
    });

    await act(async () => assistantChatMockState.onRetryModelList?.());
    expect(onRetryModelList).toHaveBeenCalledOnce();

    await act(async () => localRoot.unmount());
    el.remove();
  });

  it("honors a submitted engine the catalog offers but does not pair with the model", async () => {
    const view = await mountWithCatalog(ANTHROPIC_ENGINES, [
      "ANTHROPIC_API_KEY",
    ]);
    await act(async () => {
      dispatchSubmitChat({
        message: "m",
        submit: true,
        model: "claude-sonnet-5",
        engine: "ai-sdk:openai",
      });
      await Promise.resolve();
    });
    expect(view.engineOf()).toBe("ai-sdk:openai");
    await view.cleanup();
  });

  it("heals a selection whose engine the catalog no longer offers", async () => {
    const view = await mountWithCatalog(ANTHROPIC_ENGINES, [
      "ANTHROPIC_API_KEY",
    ]);
    await act(async () => {
      dispatchSubmitChat({
        message: "m",
        submit: true,
        model: "claude-sonnet-5",
        engine: "builder",
      });
      await Promise.resolve();
    });
    expect(view.engineOf()).toBe("anthropic");
    await view.cleanup();
  });

  it("heals a persisted selection when its provider is hidden as unconfigured", async () => {
    window.localStorage.setItem(
      "agent-native:chat-models:selection:catalog-test",
      JSON.stringify({ model: "z-ai/glm-5.2", engine: "ai-sdk:openrouter" }),
    );
    const view = await mountWithCatalog(
      [
        ...ANTHROPIC_ENGINES,
        {
          name: "ai-sdk:openrouter",
          label: "OpenRouter",
          supportedModels: ["z-ai/glm-5.2"],
          requiredEnvVars: ["OPENROUTER_API_KEY"],
        },
      ],
      ["ANTHROPIC_API_KEY"],
    );

    expect(view.engineOf()).toBe("anthropic");
    expect(view.modelOf()).toBe("claude-sonnet-5");
    await view.cleanup();
  });

  it("reconciles a saved ChatGPT model with the selected account catalog", async () => {
    window.localStorage.setItem(
      "agent-native:chat-models:selection:catalog-test",
      JSON.stringify({
        model: "model-from-previous-account",
        engine: CHATGPT_SUBSCRIPTION_ENGINE_NAME,
      }),
    );
    const view = await mountWithCatalog(
      [
        {
          name: CHATGPT_SUBSCRIPTION_ENGINE_NAME,
          label: "ChatGPT plan access",
          supportedModels: ["model-on-current-account"],
          configured: true,
          requiredEnvVars: [],
        },
      ],
      [],
    );

    expect(view.engineOf()).toBe(CHATGPT_SUBSCRIPTION_ENGINE_NAME);
    expect(view.modelOf()).toBe("model-on-current-account");
    await view.cleanup();
  });

  it("keeps the selected account catalog when an older ChatGPT read finishes late", async () => {
    await act(async () => root.unmount());
    stubCatalog([], []);
    modelCatalogMocks.load = async () =>
      chatgptCatalog("model-from-previous-account");

    root = createRoot(container);
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-model-options"),
    ).toBe("model-from-previous-account");

    const pendingCatalogs: Array<(value: unknown) => void> = [];
    modelCatalogMocks.load = () =>
      new Promise((resolve) => pendingCatalogs.push(resolve));

    act(() => {
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
    });
    expect(pendingCatalogs).toHaveLength(1);
    expect(
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-model-options"),
    ).toBe("");

    act(() => {
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
    });
    expect(pendingCatalogs).toHaveLength(2);

    await act(async () => {
      pendingCatalogs[1](chatgptCatalog("model-on-selected-account"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-model-options"),
    ).toBe("model-on-selected-account");

    await act(async () => {
      pendingCatalogs[0](chatgptCatalog("model-from-superseded-read"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-model-options"),
    ).toBe("model-on-selected-account");
  });

  it("applies a submitted model override sent without an engine", () => {
    act(() => {
      dispatchSubmitChat({
        message: "Generate design for hi page",
        submit: true,
        model: "claude-opus-4-8",
      });
    });

    expect(
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-selected-model"),
    ).toBe("claude-opus-4-8");
  });

  it("adopts model changes persisted by another shared chat surface", async () => {
    const key = "agent-native:chat-models:selection:bridge-test";
    window.localStorage.setItem(
      key,
      JSON.stringify({ model: "claude-sonnet-5", engine: "anthropic" }),
    );

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(CHAT_MODEL_SELECTION_CHANGED_EVENT, {
          detail: { key },
        }),
      );
      await Promise.resolve();
    });

    expect(
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-selected-model"),
    ).toBe("claude-sonnet-5");
  });

  it("migrates persisted legacy auto effort to high", async () => {
    window.localStorage.setItem(
      "agent-native:chat-models:selection:legacy-medium-test",
      JSON.stringify({ model: "claude-sonnet-5", effort: "auto" }),
    );

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="legacy-medium-test" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-reasoning-effort"),
    ).toBe("high");
  });

  it("continues to submit when submit is omitted", () => {
    act(() => {
      dispatchSubmitChat({
        message: "Send this now",
      });
    });

    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Send this now",
      undefined,
    );
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
  });

  it("preserves plan mode on submitted bridge messages", () => {
    act(() => {
      root.render(
        <MultiTabAssistantChat storageKey="bridge-test" execMode="plan" />,
      );
    });

    act(() => {
      dispatchSubmitChat({
        message: "Plan this first",
      });
    });

    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Plan this first",
      undefined,
      { requestMode: "plan" },
    );
  });

  it("forwards approval keys as a hidden protocol continuation", () => {
    act(() => {
      dispatchSubmitChat({
        message: "Approved.",
        approvedToolCalls: ["publish-release:{}"],
      });
    });

    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Approved.",
      undefined,
      { approvedToolCalls: ["publish-release:{}"], hideUserMessage: true },
    );
  });

  it("implements the latest plan when /act is selected", () => {
    chatHandleMocks.implementPlan.mockImplementationOnce(() => true);

    act(() => {
      assistantChatMockState.onSlashCommand?.("act");
    });

    expect(chatHandleMocks.implementPlan).toHaveBeenCalledOnce();
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
  });

  it("opens a forked thread reported by AgentKit recovery", () => {
    act(() => {
      assistantChatMockState.onForkedThread?.("thread-forked");
    });

    expect(threadMocks.switchThread).toHaveBeenCalledWith("thread-forked");
  });

  it("persists AgentKit fork parents and navigates between sibling threads", async () => {
    await act(async () => {
      assistantChatMockState.onForkedThread?.("thread-forked-a");
      assistantChatMockState.onForkedThread?.("thread-forked-b");
    });

    expect(
      window.localStorage.getItem(
        `agent-chat-fork-parent-map:bridge-test:tab:${getBrowserTabId()}`,
      ),
    ).toBe(
      JSON.stringify({
        "thread-forked-a": "thread-1",
        "thread-forked-b": "thread-1",
      }),
    );
    expect(assistantChatMockState.branchNavigation).toMatchObject({
      index: 1,
      count: 3,
    });

    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "thread-forked-a",
        title: "Fork A",
        preview: "",
        messageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
      {
        id: "thread-forked-b",
        title: "Fork B",
        preview: "",
        messageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];

    act(() => assistantChatMockState.branchNavigation?.onNext());
    expect(threadMocks.switchThread).toHaveBeenLastCalledWith(
      "thread-forked-a",
    );

    threadMocks.activeThreadId = "thread-forked-a";
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
    });
    expect(assistantChatMockState.branchNavigation).toMatchObject({
      index: 2,
      count: 3,
    });

    act(() => assistantChatMockState.branchNavigation?.onNext());
    expect(threadMocks.switchThread).toHaveBeenLastCalledWith(
      "thread-forked-b",
    );
  });

  it("reuses a known-new empty active chat for opted-in foreground sends", () => {
    threadMocks.isNewThread.mockReturnValue(true);
    const targetEvents: Event[] = [];
    const onTarget = (event: Event) => targetEvents.push(event);
    window.addEventListener("agentNative.chatSubmitTarget", onTarget);

    act(() => {
      dispatchSubmitChat({
        message: "Create a presentation",
        submit: true,
        newTab: true,
        reuseEmptyTab: true,
        tabId: "unused-new-thread",
        submitMessageId: "submit-reused",
      });
    });

    expect(threadMocks.createThread).not.toHaveBeenCalled();
    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Create a presentation",
      undefined,
      { submitMessageId: "submit-reused" },
    );
    expect((targetEvents[0] as CustomEvent).detail).toEqual({
      submitMessageId: "submit-reused",
      tabId: "thread-1",
    });
    window.removeEventListener("agentNative.chatSubmitTarget", onTarget);
  });

  it("shows a known-new chat while the separate thread list is loading", () => {
    threadMocks.isLoading = true;
    threadMocks.isNewThread.mockReturnValue(true);

    act(() => {
      root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
    });

    const chat = container.querySelector("[data-testid='assistant-chat']");
    expect(chat?.getAttribute("data-new-thread")).toBe("true");
    expect(chat?.getAttribute("data-thread-state-loading")).toBe("false");
  });

  it("keeps existing thread restoration loading while the thread list loads", () => {
    threadMocks.isLoading = true;
    threadMocks.isNewThread.mockReturnValue(false);

    act(() => {
      root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
    });

    const chat = container.querySelector("[data-testid='assistant-chat']");
    expect(chat?.getAttribute("data-new-thread")).toBe("false");
    expect(chat?.getAttribute("data-thread-state-loading")).toBe("true");
  });

  it("creates a foreground tab when the active chat has messages", async () => {
    threadMocks.isNewThread.mockReturnValue(true);
    chatHandleMocks.exportThreadSnapshot.mockReturnValueOnce({
      threadData: "{}",
      title: "Existing chat",
      preview: "Existing request",
      messageCount: 1,
    });

    act(() => {
      dispatchSubmitChat({
        message: "Create another presentation",
        submit: true,
        newTab: true,
        reuseEmptyTab: true,
        tabId: "thread-foreground",
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(threadMocks.createThread).toHaveBeenCalledWith("thread-foreground");
  });

  it("does not reuse a restoring chat that only appears empty", async () => {
    act(() => {
      dispatchSubmitChat({
        message: "Create a presentation",
        submit: true,
        newTab: true,
        reuseEmptyTab: true,
        tabId: "thread-restoring",
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(threadMocks.createThread).toHaveBeenCalledWith("thread-restoring");
  });

  it("starts background new-tab sends without focusing the new tab", async () => {
    act(() => {
      dispatchSubmitChat({
        message: "Run quietly",
        submit: true,
        newTab: true,
        background: true,
        tabId: "thread-bg",
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(threadMocks.createThread).toHaveBeenCalledWith("thread-bg");
    expect(threadMocks.switchThread).toHaveBeenCalledWith("thread-1");
    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Run quietly",
      undefined,
      { trackInRunsTray: true },
    );
  });

  it("adds keyed context to the active composer without prefill or submit", () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.setChatContext",
            data: {
              key: "selected-element",
              title: "Selected Element",
              context: "<button>Buy</button>",
            },
          },
          origin: window.location.origin,
        }),
      );
    });

    expect(
      dispatchEventSpy.mock.calls.some(
        ([event]) => event.type === "agent-panel:open",
      ),
    ).toBe(true);
    expect(chatHandleMocks.setComposerContextItem).toHaveBeenCalledWith(
      {
        key: "selected-element",
        title: "Selected Element",
        context: "<button>Buy</button>",
      },
      { focus: true },
    );
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
    dispatchEventSpy.mockRestore();
  });

  it("stages keyed context quietly when openSidebar is false", () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.setChatContext",
            data: {
              key: "selected-element",
              title: "Selected Element",
              context: "<button>Buy</button>",
              openSidebar: false,
            },
          },
          origin: window.location.origin,
        }),
      );
    });

    expect(
      dispatchEventSpy.mock.calls.some(
        ([event]) => event.type === "agent-panel:open",
      ),
    ).toBe(false);
    expect(chatHandleMocks.setComposerContextItem).toHaveBeenCalledWith(
      {
        key: "selected-element",
        title: "Selected Element",
        context: "<button>Buy</button>",
      },
      { focus: true },
    );
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
    dispatchEventSpy.mockRestore();
  });

  it("stages keyed context without focus when focus is false", () => {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.setChatContext",
            data: {
              key: "selected-element",
              title: "Selected Element",
              context: "<button>Buy</button>",
              openSidebar: false,
              focus: false,
            },
          },
          origin: window.location.origin,
        }),
      );
    });

    expect(chatHandleMocks.setComposerContextItem).toHaveBeenCalledWith(
      {
        key: "selected-element",
        title: "Selected Element",
        context: "<button>Buy</button>",
      },
      { focus: false },
    );
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
  });

  it("removes keyed context from the active composer", () => {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.removeChatContext",
            data: {
              key: "selected-element",
            },
          },
          origin: window.location.origin,
        }),
      );
    });

    expect(chatHandleMocks.removeComposerContextItem).toHaveBeenCalledWith(
      "selected-element",
    );
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
  });

  it("clears context from the active composer", () => {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.clearChatContext",
            data: {},
          },
          origin: window.location.origin,
        }),
      );
    });

    expect(chatHandleMocks.clearComposerContextItems).toHaveBeenCalled();
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
  });

  it("opens a replacement tab and closes the current tab when clearing chat", async () => {
    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    threadMocks.createThread.mockImplementationOnce(async () => {
      const id = "thread-clear";
      threadMocks.activeThreadId = id;
      threadMocks.threads = [
        {
          id,
          title: "",
          preview: "",
          messageCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          scope: null,
        },
        ...threadMocks.threads,
      ];
      return id;
    });

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual(["thread-1"]);

    await act(async () => {
      headerProps?.clearActiveTab();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual(["thread-clear"]);
  });

  it("keeps a chat mounted when scoped navigation has no saved open tabs", async () => {
    let tabs: Array<{ id: string }> = [];
    const renderHeader = (props: { tabs: Array<{ id: string }> }) => {
      tabs = props.tabs;
      return null;
    };

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="scope-reset-test"
          renderHeader={renderHeader}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tabs.map((tab) => tab.id)).toEqual(["thread-1"]);

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="scope-reset-test"
          scope={{ type: "design", id: "design-1", label: "QA Smoke" }}
          renderHeader={renderHeader}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tabs.map((tab) => tab.id)).toEqual(["thread-1"]);
    expect(
      container.querySelectorAll("[data-testid='assistant-chat']"),
    ).toHaveLength(1);
    expect(chatThreadHookMocks.useChatThreads).toHaveBeenLastCalledWith(
      "/_agent-native/agent-chat",
      "scope-reset-test",
      { type: "design", id: "design-1", label: "QA Smoke" },
      expect.objectContaining({ restoreActiveThread: true }),
    );
  });

  it("rehydrates the open tabs for the newly active resource scope", async () => {
    const storageKey = "scope-navigation-test";
    const scopedOpenTabsKey = (designId: string) =>
      openTabsStorageKey(storageKey, { type: "design", id: designId });
    const baseThread = threadMocks.threads[0];
    threadMocks.threads = [
      { ...baseThread, id: "thread-a" },
      { ...baseThread, id: "thread-b" },
    ];
    threadMocks.activeThreadId = "thread-a";
    window.localStorage.setItem(
      scopedOpenTabsKey("design-a"),
      JSON.stringify(["thread-a"]),
    );
    window.localStorage.setItem(
      scopedOpenTabsKey("design-b"),
      JSON.stringify(["thread-b"]),
    );

    let tabs: Array<{ id: string }> = [];
    const renderHeader = (props: { tabs: Array<{ id: string }> }) => {
      tabs = props.tabs;
      return null;
    };

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey={storageKey}
          scope={{ type: "design", id: "design-a" }}
          renderHeader={renderHeader}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tabs.map((tab) => tab.id)).toEqual(["thread-a"]);

    threadMocks.activeThreadId = "thread-b";
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey={storageKey}
          scope={{ type: "design", id: "design-b" }}
          renderHeader={renderHeader}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tabs.map((tab) => tab.id)).toEqual(["thread-b"]);
  });

  it("renders resource context as a normal composer context item", async () => {
    threadMocks.threads = [
      {
        ...threadMocks.threads[0],
        scope: { type: "form", id: "form-1" },
      },
    ];

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{ type: "form", id: "form-1" }}
          composerSlot={<div data-testid="host-composer-slot">Host slot</div>}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const hostSlot = container.querySelector(
      "[data-testid='host-composer-slot']",
    );
    const composerChildren = Array.from(
      container.querySelector("[data-testid='assistant-chat']")?.children ?? [],
    );
    expect(
      container.querySelectorAll(".agent-scope-badge-wrapper"),
    ).toHaveLength(0);
    expect(container.textContent).not.toContain("Using this form");
    expect(listAgentChatContext()).toEqual([
      expect.objectContaining({
        key: "agent-current-resource-context",
        title: "Form",
        context: expect.stringContaining("Resource context: form:form-1"),
      }),
    ]);
    expect(composerChildren).toEqual([hostSlot]);
  });

  it("replaces a legacy generated resource chip when the scope changes", async () => {
    setAgentChatContextItem({
      key: "agent-current-resource-context",
      title: "Old app",
      context: "Resource context: desktop-app:old-app\nResource name: Old app",
    });

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{
            type: "desktop-app",
            id: "new-app",
            label: "New app",
          }}
        />,
      );
      await Promise.resolve();
    });

    expect(listAgentChatContext()).toEqual([
      expect.objectContaining({
        key: "agent-current-resource-context",
        title: "New app",
        context: expect.stringContaining(
          "Resource context: desktop-app:new-app",
        ),
      }),
    ]);
  });

  it("updates resource context in place when only its label changes", async () => {
    const contextTransitions: string[][] = [];
    const onContextChanged = (event: Event) => {
      const items = (event as CustomEvent<{ items: Array<{ key: string }> }>)
        .detail.items;
      contextTransitions.push(items.map((item) => item.key));
    };
    window.addEventListener(AGENT_CHAT_CONTEXT_CHANGED_EVENT, onContextChanged);

    try {
      await act(async () => {
        root.render(
          <MultiTabAssistantChat
            storageKey="bridge-test"
            scope={{ type: "deck", id: "deck-1", label: "This Slide" }}
          />,
        );
        await Promise.resolve();
      });
      contextTransitions.length = 0;

      await act(async () => {
        root.render(
          <MultiTabAssistantChat
            storageKey="bridge-test"
            scope={{
              type: "deck",
              id: "deck-1",
              label: "Current Selection",
            }}
          />,
        );
        await Promise.resolve();
      });

      expect(listAgentChatContext()).toEqual([
        expect.objectContaining({ title: "Current Selection" }),
      ]);
      expect(contextTransitions).not.toContainEqual([]);
    } finally {
      window.removeEventListener(
        AGENT_CHAT_CONTEXT_CHANGED_EVENT,
        onContextChanged,
      );
    }
  });

  it("does not restore a resource context after it is dismissed", async () => {
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{ type: "deck", id: "deck-1", label: "This Slide" }}
        />,
      );
      await Promise.resolve();
    });

    removeAgentChatContextItem("agent-current-resource-context");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{
            type: "deck",
            id: "deck-1",
            label: "Current Selection",
          }}
        />,
      );
      await Promise.resolve();
    });

    expect(listAgentChatContext()).toEqual([]);
  });

  it("restores dismissed resource context when the target slide changes", async () => {
    const baseScope = {
      type: "deck" as const,
      id: "deck-1",
      label: "This Slide",
      context: "Current slide id: slide-1.",
      contextVersion: "deck-1|slide-1|1",
    };
    await act(async () => {
      root.render(
        <MultiTabAssistantChat storageKey="bridge-test" scope={baseScope} />,
      );
      await Promise.resolve();
    });

    removeAgentChatContextItem("agent-current-resource-context");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{
            ...baseScope,
            context: "Current slide id: slide-2.",
            contextVersion: "deck-1|slide-2|2",
          }}
        />,
      );
      await Promise.resolve();
    });

    expect(listAgentChatContext()).toEqual([
      expect.objectContaining({
        context: expect.stringContaining("Current slide id: slide-2."),
      }),
    ]);
  });

  it("passes an app context namespace to the active composer", async () => {
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{
            type: "desktop-app",
            id: "calendar",
            label: "Calendar",
            contextKey: "desktop-app:calendar",
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-context-namespace"),
    ).toBe("desktop-app:calendar");
    expect(
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-context-scope"),
    ).toBe("desktop-app:calendar");
    expect(listAgentChatContext()).toEqual([
      expect.objectContaining({
        key: "desktop-app:calendar",
        contextNamespace: "desktop-app:calendar",
      }),
    ]);
  });

  it("keeps resource context in the composer when the legacy badge flag is false", async () => {
    threadMocks.threads = [
      {
        ...threadMocks.threads[0],
        scope: { type: "design", id: "design-1" },
      },
    ];

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{ type: "design", id: "design-1" }}
          showScopeBadge={false}
          composerSlot={<div data-testid="host-composer-slot">Host slot</div>}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelectorAll(".agent-scope-badge-wrapper"),
    ).toHaveLength(0);
    expect(listAgentChatContext()).toEqual([
      expect.objectContaining({
        key: "agent-current-resource-context",
        title: "Design",
      }),
    ]);
  });

  it("does not remove richer app-owned context when resource context unmounts", async () => {
    setAgentChatContextItem({
      key: "analytics-selected-dashboard",
      title: "Dashboard",
      context: "Dashboard context from the analytics app",
    });

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{
            type: "dashboard",
            id: "dashboard-1",
            contextKey: "analytics-selected-dashboard",
          }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
      await Promise.resolve();
    });

    expect(listAgentChatContext()).toEqual([
      expect.objectContaining({
        key: "analytics-selected-dashboard",
        context: "Dashboard context from the analytics app",
      }),
    ]);
  });

  it("keeps resource history out of the empty chat state", async () => {
    const now = Date.now();
    threadMocks.threads = [
      {
        ...threadMocks.threads[0],
        scope: { type: "form", id: "form-1" },
        messageCount: 0,
        updatedAt: now,
      },
      {
        id: "thread-2",
        title: "Older form chat",
        preview: "",
        messageCount: 1,
        createdAt: now - 1000,
        updatedAt: now - 1000,
        scope: { type: "form", id: "form-1" },
      },
    ];

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{ type: "form", id: "form-1" }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Using this form");
    expect(container.textContent).not.toContain("Previous chats for this form");
  });

  it("adopts the thread route on its first accepted save, not on submit", async () => {
    const navigate = vi.fn();
    window.history.replaceState(null, "", "/chat");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          threadUrlSync={{
            routeThreadId: null,
            getPath: (threadId) =>
              threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat",
            navigate,
          }}
        />,
      );
    });

    expect(navigate).not.toHaveBeenCalled();

    act(() => {
      assistantChatMockState.onSaveThread?.("thread-1", {
        threadData: JSON.stringify({ messages: [{ id: "message-1" }] }),
        title: "New chat",
        preview: "Hello",
        messageCount: 1,
        titleSource: "fallback",
      });
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/chat/thread-1", { replace: false });
  });

  it("does not move the route when a background chat is first saved", async () => {
    const navigate = vi.fn();
    window.history.replaceState(null, "", "/chat");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          threadUrlSync={{
            routeThreadId: null,
            getPath: (threadId) =>
              threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat",
            navigate,
          }}
        />,
      );
    });

    act(() => {
      assistantChatMockState.onSaveThread?.("thread-2", {
        threadData: JSON.stringify({ messages: [{ id: "message-2" }] }),
        title: "Background chat",
        preview: "Hello",
        messageCount: 1,
        titleSource: "fallback",
      });
    });

    expect(navigate).not.toHaveBeenCalled();
  });

  it("syncs selected and new chat states to the URL when enabled", async () => {
    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "thread-2",
        title: "Second thread",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];
    threadMocks.createThread.mockImplementationOnce(async () => "thread-new");
    window.history.replaceState(null, "", "/?thread=thread-1");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          threadUrlSync
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      headerProps?.setActiveTabId("thread-2");
    });
    expect(window.location.search).toBe("?thread=thread-2");

    await act(async () => {
      await headerProps?.addTab();
      await Promise.resolve();
    });
    expect(window.location.search).toBe("");
  });

  it("reacts when client-side navigation clears the thread query param", async () => {
    window.history.replaceState(null, "", "/?thread=thread-1");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat storageKey="bridge-test" threadUrlSync />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(chatThreadHookMocks.useChatThreads).toHaveBeenLastCalledWith(
      expect.any(String),
      "bridge-test",
      null,
      expect.objectContaining({ routeThreadId: "thread-1" }),
    );

    act(() => {
      window.history.pushState(null, "", "/");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(chatThreadHookMocks.useChatThreads).toHaveBeenLastCalledWith(
      expect.any(String),
      "bridge-test",
      null,
      expect.objectContaining({ routeThreadId: null }),
    );
  });

  it("opens a shared thread link even when URL syncing is not enabled", async () => {
    window.history.replaceState(null, "", "/overview?thread=thread-1");

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(chatThreadHookMocks.useChatThreads).toHaveBeenLastCalledWith(
      expect.any(String),
      "bridge-test",
      null,
      expect.objectContaining({ routeThreadId: "thread-1" }),
    );
  });

  it("accepts a shared query thread on a route-owned chat home", async () => {
    window.history.replaceState(null, "", "/?thread=thread-1");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          threadUrlSync={{
            routeThreadId: null,
            getPath: (threadId) =>
              threadId ? `/chat/${encodeURIComponent(threadId)}` : "/",
            navigate: vi.fn(),
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(chatThreadHookMocks.useChatThreads).toHaveBeenLastCalledWith(
      expect.any(String),
      "bridge-test",
      null,
      expect.objectContaining({ routeThreadId: "thread-1" }),
    );
  });

  it("rewrites a shared query thread on the route-owned home to its thread path", async () => {
    const navigate = vi.fn();
    window.history.replaceState(null, "", "/chat?thread=thread-1");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          threadUrlSync={{
            routeThreadId: null,
            getPath: (threadId) =>
              threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat",
            navigate,
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/chat/thread-1", { replace: true });
  });

  it("accepts a route-owned thread id for path-based chat routes", async () => {
    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    const navigate = vi.fn();
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "thread-2",
        title: "Second thread",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];
    window.history.replaceState(null, "", "/chat/thread-1");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          threadUrlSync={{
            routeThreadId: "thread-1",
            getPath: (threadId) =>
              threadId ? `/chat/${encodeURIComponent(threadId)}` : "/",
            navigate,
          }}
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(chatThreadHookMocks.useChatThreads).toHaveBeenLastCalledWith(
      expect.any(String),
      "bridge-test",
      null,
      expect.objectContaining({ routeThreadId: "thread-1" }),
    );

    act(() => {
      headerProps?.setActiveTabId("thread-2");
    });

    expect(navigate).toHaveBeenCalledWith("/chat/thread-2", {
      replace: false,
    });

    window.history.pushState(null, "", "/");
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          threadUrlSync={{
            routeThreadId: null,
            getPath: (threadId) =>
              threadId ? `/chat/${encodeURIComponent(threadId)}` : "/",
            navigate,
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(chatThreadHookMocks.useChatThreads).toHaveBeenLastCalledWith(
      expect.any(String),
      "bridge-test",
      null,
      expect.objectContaining({ routeThreadId: null }),
    );
  });
});

describe("MultiTabAssistantChat cold-start first message", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: null })),
    );
    window.localStorage.clear();
    window.localStorage.setItem(
      openTabsStorageKey("cold-start"),
      JSON.stringify(["thread-1"]),
    );
    threadMocks.activeThreadId = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    threadMocks.activeThreadId = "thread-1";
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("buffers the first message and delivers it once a thread exists", async () => {
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="cold-start" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      dispatchSubmitChat({ message: "First message" });
    });
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();

    threadMocks.activeThreadId = "thread-1";
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="cold-start" />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(chatHandleMocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "First message",
      undefined,
    );
    expect(threadMocks.createThread).not.toHaveBeenCalled();
  });
});

describe("MultiTabAssistantChat cold-start delivery (Mode B)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: null })),
    );
    window.localStorage.clear();
    window.localStorage.setItem(
      openTabsStorageKey("mode-b"),
      JSON.stringify(["thread-1"]),
    );
    clearBufferedAgentChatRequests();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    clearBufferedAgentChatRequests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("delivers a message sent before the lazy panel mounted its listener", async () => {
    act(() => {
      sendToAgentChat({ message: "Sent before mount", submit: true });
    });
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(chatHandleMocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Sent before mount",
      undefined,
      { submitMessageId: expect.any(String) },
    );
  });

  it("ignores a duplicate submit with the same submitMessageId", async () => {
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      dispatchSubmitChat({ message: "Once only", submitMessageId: "dup-1" });
    });
    act(() => {
      dispatchSubmitChat({ message: "Once only", submitMessageId: "dup-1" });
    });

    expect(chatHandleMocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Once only",
      undefined,
      { submitMessageId: "dup-1" },
    );
  });

  it("drops a pending delivery after its confirmation times out", async () => {
    threadMocks.activeThreadId = "";
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });

    act(() => {
      dispatchSubmitChat({
        message: "Never deliver late",
        submitMessageId: "cancelled-submit",
      });
    });
    cancelAgentChatSubmit("cancelled-submit");

    threadMocks.activeThreadId = "thread-1";
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
  });

  it("replays an open-thread request sent before the lazy panel mounted", async () => {
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "thread-2",
        title: "Run thread",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];

    act(() => {
      requestAgentChatThreadOpen({ threadId: "thread-2" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(threadMocks.switchThread).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(threadMocks.switchThread).toHaveBeenCalledWith("thread-2");
    expect(threadMocks.openThread).toHaveBeenCalledWith("thread-2");
  });

  it("opens and prefills the requested thread without sending to the previous chat", async () => {
    resetThreadMocks();
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "background-thread",
        title: "Background run",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });

    act(() => {
      requestAgentChatThreadOpen({
        threadId: "background-thread",
        prefill: "Continue the background run",
      });
    });
    threadMocks.activeThreadId = "background-thread";
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(threadMocks.switchThread).toHaveBeenCalledWith("background-thread");
    expect(threadMocks.openThread).toHaveBeenCalledWith("background-thread");
    expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
      "Continue the background run",
    );
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
  });

  it("does not let an earlier slow open override a later request", async () => {
    let resolveFirst!: (value: "opened") => void;
    const firstOpen = new Promise<"opened">((resolve) => {
      resolveFirst = resolve;
    });
    threadMocks.openThread.mockImplementation((threadId: string) =>
      threadId === "slow-thread" ? firstOpen : Promise.resolve("opened"),
    );
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });

    act(() => {
      requestAgentChatThreadOpen({ threadId: "slow-thread" });
      requestAgentChatThreadOpen({ threadId: "latest-thread" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(threadMocks.switchThread).toHaveBeenCalledWith("latest-thread");

    await act(async () => {
      resolveFirst("opened");
      await Promise.resolve();
    });
    expect(threadMocks.switchThread).not.toHaveBeenCalledWith("slow-thread");
    threadMocks.openThread.mockReset();
    threadMocks.openThread.mockResolvedValue("opened");
  });

  it("does not retain a prefill when the requested thread is unavailable", async () => {
    threadMocks.openThread.mockResolvedValue("missing");
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });

    act(() => {
      requestAgentChatThreadOpen({
        threadId: "missing-thread",
        prefill: "Do not retain this prefill",
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(threadMocks.switchThread).not.toHaveBeenCalledWith("missing-thread");
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalledWith(
      "Do not retain this prefill",
    );
    threadMocks.openThread.mockReset();
    threadMocks.openThread.mockResolvedValue("opened");
  });

  it("does not restore a transient thread after the user selected another one", async () => {
    threadMocks.activeThreadId = "thread-2";
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "thread-2",
        title: "Other thread",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
    });

    act(() => {
      requestAgentChatThreadOpen({
        threadId: "thread-1",
        onlyIfActiveThreadId: "thread-1",
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(threadMocks.switchThread).not.toHaveBeenCalled();
  });

  it("restores a transient thread while its captured thread is still active", async () => {
    threadMocks.activeThreadId = "thread-1";
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });

    act(() => {
      requestAgentChatThreadOpen({
        threadId: "thread-1",
        onlyIfActiveThreadId: "thread-1",
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(threadMocks.switchThread).toHaveBeenCalledWith("thread-1");
  });

  it("replays an agent-task open request sent before the lazy panel mounted", async () => {
    let tabs: Array<{
      id: string;
      parentThreadId?: string;
      subAgentName?: string;
    }> = [];
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "thread-child",
        title: "Research child",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];

    act(() => {
      requestAgentTaskOpen({
        threadId: "thread-child",
        parentThreadId: "thread-1",
        name: "Research",
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(threadMocks.switchThread).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="mode-b"
          renderHeader={(props) => {
            tabs = props.tabs;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(threadMocks.switchThread).toHaveBeenCalledWith("thread-child");
    expect(tabs).toContainEqual(
      expect.objectContaining({
        id: "thread-child",
        parentThreadId: "thread-1",
        subAgentName: "Research",
      }),
    );
  });
});

describe("MultiTabAssistantChat agent-team tabs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetThreadMocks();
    threadMocks.threads = [
      {
        id: "thread-1",
        title: "Main thread",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
      {
        id: "thread-child",
        title: "Research child",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs/list?goalId=agent-team")) {
          return Response.json({
            runs: [
              {
                title: "Research child",
                status: "running",
                sourceRecord: {
                  type: "agent-team-task",
                  threadId: "thread-child",
                  parentThreadId: "thread-1",
                  name: "Research",
                },
                metadata: {},
              },
            ],
          });
        }
        return Response.json({ value: null });
      }),
    );
    window.localStorage.clear();
    window.localStorage.setItem(
      openTabsStorageKey("agent-team-test"),
      JSON.stringify(["thread-1"]),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("hydrates running sub-agent tasks into child tabs", async () => {
    let tabs: Array<{
      id: string;
      parentThreadId?: string;
      status: string;
      subAgentName?: string;
    }> = [];

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="agent-team-test"
          renderHeader={(props) => {
            tabs = props.tabs;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tabs).toContainEqual(
      expect.objectContaining({
        id: "thread-child",
        parentThreadId: "thread-1",
        status: "running",
        subAgentName: "Research",
      }),
    );
  });
});

describe("MultiTabAssistantChat tab close/open lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  function makeThread(id: string): ChatThreadSummary {
    return {
      id,
      title: "",
      preview: "",
      messageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scope: null,
    };
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetThreadMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: null })),
    );
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("de-duplicates an open-tabs list restored from localStorage", async () => {
    threadMocks.activeThreadId = "thread-1";
    threadMocks.threads = [makeThread("thread-1"), makeThread("thread-2")];
    window.localStorage.setItem(
      openTabsStorageKey("dup-test"),
      JSON.stringify(["thread-1", "thread-2", "thread-2"]),
    );

    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="dup-test"
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual([
      "thread-1",
      "thread-2",
    ]);
  });

  it("does not use the first message preview as the tab label", async () => {
    threadMocks.activeThreadId = "thread-1";
    threadMocks.threads = [
      {
        ...makeThread("thread-1"),
        preview: "Please summarize the latest release notes",
        messageCount: 1,
      },
    ];
    window.localStorage.setItem(
      openTabsStorageKey("prompt-label-test"),
      JSON.stringify(["thread-1"]),
    );

    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="prompt-label-test"
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(headerProps?.tabs[0]?.label).not.toBe(
      "Please summarize the latest release notes",
    );
  });

  it("renders a labeled close button per tab and only closes the tab whose close button is clicked", async () => {
    threadMocks.activeThreadId = "thread-1";
    threadMocks.threads = [makeThread("thread-1"), makeThread("thread-2")];
    window.localStorage.setItem(
      openTabsStorageKey("close-button-test"),
      JSON.stringify(["thread-1", "thread-2"]),
    );

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="close-button-test" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const closeButtons = () =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          'button[aria-label="Close tab"]',
        ),
      );
    expect(closeButtons()).toHaveLength(2);

    // The reported bug was a hit zone that stayed clickable while invisible
    // (opacity alone does not disable pointer-events). jsdom/happy-dom does
    // not compute real hover-driven hit-testing for a plain `.click()` call,
    // so guard the actual CSS invariant directly: the close button must be
    // non-interactive by default and only regain pointer-events together
    // with becoming visible, scoped to a real ancestor of the button.
    const styleText = container.querySelector("style")?.textContent ?? "";
    expect(styleText).toContain(
      ".agent-tab-close{opacity:0;pointer-events:none}",
    );
    expect(styleText).toContain(
      ".agent-tab-group:hover .agent-tab-close,.agent-tab-close:focus-visible{opacity:1;pointer-events:auto}",
    );
    const closeButtonGroupAncestor =
      closeButtons()[0].closest(".agent-tab-group");
    expect(closeButtonGroupAncestor?.contains(closeButtons()[0])).toBe(true);

    const secondTabSwitchButton = container.querySelectorAll<HTMLButtonElement>(
      ".agent-tab > button:first-child",
    )[1];
    expect(secondTabSwitchButton).toBeTruthy();
    act(() => {
      secondTabSwitchButton.click();
    });
    expect(closeButtons()).toHaveLength(2);
    expect(threadMocks.switchThread).toHaveBeenCalledWith("thread-2");

    act(() => {
      closeButtons()[1].click();
    });
    expect(closeButtons()).toHaveLength(1);
  });

  it("removes a revoked explicit thread from open and mounted tabs", async () => {
    const storageKey = "revoked-explicit-thread";
    threadMocks.activeThreadId = "protected-thread";
    threadMocks.threads = [
      makeThread("protected-thread"),
      makeThread("remaining-thread"),
    ];
    window.localStorage.setItem(
      openTabsStorageKey(storageKey),
      JSON.stringify(["protected-thread", "remaining-thread"]),
    );
    let tabs: MultiTabAssistantChatHeaderProps["tabs"] = [];

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey={storageKey}
          renderHeader={(props) => {
            tabs = props.tabs;
            return null;
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(tabs.map((tab) => tab.id)).toContain("protected-thread");

    threadMocks.activeThreadId = null;
    threadMocks.threads = [makeThread("remaining-thread")];
    threadMocks.evictedThreadIds = ["protected-thread"];
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey={storageKey}
          renderHeader={(props) => {
            tabs = props.tabs;
            return null;
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tabs.map((tab) => tab.id)).not.toContain("protected-thread");
    expect(
      JSON.parse(
        window.localStorage.getItem(openTabsStorageKey(storageKey)) ?? "[]",
      ),
    ).not.toContain("protected-thread");
  });

  it("migrates legacy open tabs and sub-agent metadata into this browser tab", async () => {
    const storageKey = "legacy-tab-migration-test";
    const child = makeThread("thread-child");
    threadMocks.activeThreadId = "thread-1";
    threadMocks.threads = [
      makeThread("thread-1"),
      makeThread("thread-2"),
      child,
    ];
    window.localStorage.setItem(
      legacyOpenTabsStorageKey(storageKey),
      JSON.stringify(["thread-1", "thread-2", "thread-2", "thread-child"]),
    );
    window.localStorage.setItem(
      `agent-chat-parent-map:${storageKey}`,
      JSON.stringify({ "thread-child": "thread-1" }),
    );
    window.localStorage.setItem(
      `agent-chat-sub-agent-names:${storageKey}`,
      JSON.stringify({ "thread-child": "Research" }),
    );

    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey={storageKey}
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const tabId = getBrowserTabId();
    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual([
      "thread-1",
      "thread-2",
    ]);
    expect(
      JSON.parse(
        window.localStorage.getItem(openTabsStorageKey(storageKey)) ?? "null",
      ),
    ).toEqual(["thread-1", "thread-2"]);
    expect(
      JSON.parse(
        window.localStorage.getItem(
          `agent-chat-parent-map:${storageKey}:tab:${tabId}`,
        ) ?? "null",
      ),
    ).toEqual({ "thread-child": "thread-1" });
    expect(
      JSON.parse(
        window.localStorage.getItem(
          `agent-chat-sub-agent-names:${storageKey}:tab:${tabId}`,
        ) ?? "null",
      ),
    ).toEqual({ "thread-child": "Research" });
  });

  it("commits new and cleared tabs without disturbing the other open tabs", async () => {
    const storageKey = "new-tab-lifecycle-test";
    threadMocks.activeThreadId = "thread-2";
    threadMocks.threads = [
      makeThread("thread-1"),
      makeThread("thread-2"),
      makeThread("thread-3"),
    ];
    window.localStorage.setItem(
      openTabsStorageKey(storageKey),
      JSON.stringify(["thread-1", "thread-2", "thread-3"]),
    );

    const createdIds = ["thread-new", "thread-replacement"];
    threadMocks.createThread.mockImplementation(async () => {
      const id = createdIds.shift();
      if (!id) throw new Error("test exhausted its thread ids");
      threadMocks.activeThreadId = id;
      threadMocks.threads = [...threadMocks.threads, makeThread(id)];
      return id;
    });

    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey={storageKey}
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await headerProps?.addTab();
    });

    expect(headerProps?.activeTabId).toBe("thread-new");
    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual([
      "thread-1",
      "thread-2",
      "thread-3",
      "thread-new",
    ]);

    await act(async () => {
      headerProps?.clearActiveTab();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(headerProps?.activeTabId).toBe("thread-replacement");
    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual([
      "thread-1",
      "thread-2",
      "thread-3",
      "thread-replacement",
    ]);
  });

  it("replaces an active missing thread with a fresh chat", async () => {
    const replacementId = "thread-replacement";
    window.history.replaceState({}, "", "/?thread=missing-thread");
    threadMocks.activeThreadId = "missing-thread";
    threadMocks.threads = [makeThread("missing-thread")];
    threadMocks.createThread.mockImplementationOnce(async () => {
      threadMocks.activeThreadId = replacementId;
      threadMocks.threads = [makeThread(replacementId), ...threadMocks.threads];
      return replacementId;
    });

    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="missing-thread-test"
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(assistantChatMockState.onThreadRestoreNotFound).toEqual(
      expect.any(Function),
    );

    await act(async () => {
      assistantChatMockState.onThreadRestoreNotFound?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual([replacementId]);
    expect(new URL(window.location.href).searchParams.has("thread")).toBe(
      false,
    );
    expect(chatThreadHookMocks.useChatThreads).toHaveBeenLastCalledWith(
      expect.any(String),
      "missing-thread-test",
      null,
      expect.objectContaining({ routeThreadId: undefined }),
    );
  });

  it("does not replace a desktop thread before identity restore settles", async () => {
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          agentChatSurface="desktop"
          desktopIdentityAuthenticated={false}
          storageKey="desktop-missing-thread-test"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(assistantChatMockState.onThreadRestoreNotFound).toBeUndefined();
  });

  it("gives short chat titles enough room before the close target", async () => {
    threadMocks.activeThreadId = "short-title-thread";
    threadMocks.threads = [
      {
        ...makeThread("short-title-thread"),
        title: "hi",
        messageCount: 1,
      },
    ];
    window.localStorage.setItem(
      openTabsStorageKey("short-title-test"),
      JSON.stringify(["short-title-thread"]),
    );

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="short-title-test" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector(".agent-tab")?.className).toContain(
      "min-w-[56px]",
    );
  });

  it("closes a duplicated active tab instead of the effect re-adding it", async () => {
    threadMocks.activeThreadId = "thread-1";
    threadMocks.threads = [makeThread("thread-1")];
    window.localStorage.setItem(
      openTabsStorageKey("dup-active-test"),
      JSON.stringify(["thread-1", "thread-1"]),
    );
    threadMocks.createThread.mockImplementation(async () => {
      threadMocks.activeThreadId = "thread-new";
      threadMocks.threads = [makeThread("thread-new")];
      return "thread-new";
    });

    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="dup-active-test"
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      headerProps?.closeTab("thread-1");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).not.toContain("thread-1");
  });

  it("closing one tab removes only that tab, leaving its siblings open", async () => {
    threadMocks.activeThreadId = "thread-1";
    threadMocks.threads = [
      makeThread("thread-1"),
      makeThread("thread-2"),
      makeThread("thread-3"),
    ];
    window.localStorage.setItem(
      openTabsStorageKey("close-test"),
      JSON.stringify(["thread-1", "thread-2", "thread-3"]),
    );

    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="close-test"
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual([
      "thread-1",
      "thread-2",
      "thread-3",
    ]);

    await act(async () => {
      headerProps?.closeTab("thread-2");
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual([
      "thread-1",
      "thread-3",
    ]);

    await act(async () => {
      threadMocks.threads = [...threadMocks.threads, makeThread("thread-4")];
      root.render(
        <MultiTabAssistantChat
          storageKey="close-test"
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
      await Promise.resolve();
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual([
      "thread-1",
      "thread-3",
    ]);
  });

  it("replaces the only open tab with a fresh one instead of ending up empty", async () => {
    threadMocks.activeThreadId = "thread-1";
    threadMocks.threads = [makeThread("thread-1")];
    window.localStorage.setItem(
      openTabsStorageKey("last-tab-test"),
      JSON.stringify(["thread-1"]),
    );
    threadMocks.createThread.mockImplementation(async () => {
      threadMocks.activeThreadId = "thread-new";
      threadMocks.threads = [...threadMocks.threads, makeThread("thread-new")];
      return "thread-new";
    });

    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="last-tab-test"
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      headerProps?.closeTab("thread-1");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(threadMocks.createThread).toHaveBeenCalledTimes(1);
    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual(["thread-new"]);
  });

  it("does not create duplicate replacement threads when the final tab is closed twice", async () => {
    threadMocks.activeThreadId = "thread-1";
    threadMocks.threads = [makeThread("thread-1")];
    window.localStorage.setItem(
      openTabsStorageKey("duplicate-close-test"),
      JSON.stringify(["thread-1"]),
    );

    let resolveReplacement: ((id: string) => void) | undefined;
    threadMocks.createThread.mockImplementationOnce(async () => {
      threadMocks.activeThreadId = "thread-new";
      threadMocks.threads = [...threadMocks.threads, makeThread("thread-new")];
      return await new Promise<string>((resolve) => {
        resolveReplacement = resolve;
      });
    });

    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="duplicate-close-test"
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      headerProps?.closeTab("thread-1");
      headerProps?.closeTab("thread-1");
    });

    expect(threadMocks.createThread).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveReplacement?.("thread-new");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual(["thread-new"]);
  });

  it("does not duplicate a tab when a buffered backlog opens one thread twice", async () => {
    clearBufferedAgentChatRequests();
    threadMocks.activeThreadId = "thread-1";
    threadMocks.threads = [makeThread("thread-1"), makeThread("thread-2")];
    window.localStorage.setItem(
      openTabsStorageKey("backlog-test"),
      JSON.stringify(["thread-1"]),
    );

    requestAgentTaskOpen({
      threadId: "thread-2",
      parentThreadId: "thread-1",
      name: "Sub agent",
    });
    requestAgentTaskOpen({
      threadId: "thread-2",
      parentThreadId: "thread-1",
      name: "Sub agent",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="backlog-test"
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual([
      "thread-1",
      "thread-2",
    ]);

    await act(async () => {
      headerProps?.closeTab("thread-2");
      await Promise.resolve();
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual(["thread-1"]);
  });
});

describe("MultiTabAssistantChat page overlay", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetThreadMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: null })),
    );
    window.localStorage.clear();
    window.localStorage.setItem(
      openTabsStorageKey("page-overlay-test"),
      JSON.stringify(["thread-1"]),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("marks the page overlay only after the thread scrolls", async () => {
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="page-overlay-test"
          renderOverlay={() => (
            <div className="agent-chat-scroll" data-testid="chat-scroll" />
          )}
        />,
      );
    });

    const scrollTarget = container.querySelector<HTMLElement>(
      '[data-testid="chat-scroll"]',
    );
    expect(scrollTarget).not.toBeNull();
    expect(
      container.querySelector("[data-agent-page-chat-topbar]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-agent-page-chat-scrolled]"),
    ).toBeNull();

    await act(async () => {
      if (!scrollTarget) return;
      scrollTarget.scrollTop = 24;
      scrollTarget.dispatchEvent(new Event("scroll"));
    });

    expect(
      container.querySelector("[data-agent-page-chat-scrolled]"),
    ).not.toBeNull();
  });

  it("reserves one page-header height when its actions are temporarily empty", async () => {
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="page-overlay-test"
          renderOverlay={() => null}
        />,
      );
    });

    const topbar = container.querySelector<HTMLElement>(
      "[data-agent-page-chat-topbar]",
    );
    expect(topbar).not.toBeNull();
    expect(topbar?.className).toContain("pt-12");
  });
});

describe("MultiTabAssistantChat history popover", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    resetThreadMocks();
    const now = Date.now();
    threadMocks.activeThreadId = "thread-1";
    const historyThreads: ChatThreadSummary[] = [
      {
        id: "thread-1",
        title: "Active chat",
        preview: "",
        messageCount: 1,
        createdAt: now,
        updatedAt: now,
        scope: null,
      },
      {
        id: "thread-2",
        title: "Pinned chat",
        preview: "",
        messageCount: 2,
        createdAt: now,
        updatedAt: now,
        scope: null,
        pinnedAt: now,
      },
      {
        id: "thread-3",
        title: "Other chat",
        preview: "",
        messageCount: 3,
        createdAt: now,
        updatedAt: now,
        scope: null,
      },
    ];
    threadMocks.threads = historyThreads;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: null })),
    );
    window.localStorage.clear();
    window.localStorage.setItem(
      openTabsStorageKey("history-test"),
      JSON.stringify(["thread-1"]),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function openHistory() {
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="history-test" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const historyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="All chats"]',
    );
    expect(historyButton).not.toBeNull();
    act(() => {
      historyButton!.click();
    });
  }

  async function openRowMenu(trigger: HTMLButtonElement) {
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      await Promise.resolve();
    });
  }

  it("groups pinned threads into a dedicated section, sorted ahead of the rest", async () => {
    await openHistory();

    const labels = Array.from(
      container.querySelectorAll(".an-chat-history__section-label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["Pinned"]);

    const titles = Array.from(
      container.querySelectorAll(".an-chat-history-row__title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Pinned chat", "Active chat", "Other chat"]);
  });

  it("anchors page-overlay chat history to the left below the page header", async () => {
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="history-test"
          renderOverlay={({ toggleHistory }) => (
            <button
              type="button"
              data-testid="page-history-trigger"
              onClick={toggleHistory}
            >
              All chats
            </button>
          )}
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="page-history-trigger"]',
        )
        ?.click();
    });

    const anchor = Array.from(
      container.querySelectorAll<HTMLElement>("span"),
    ).find((span) => span.classList.contains("w-px"));
    expect(anchor).toBeDefined();
    expect(anchor?.className).toContain("start-2");
    expect(anchor?.className).toContain("top-12");
    expect(anchor?.className).not.toContain("end-2");
  });

  it("does not expose an untitled prompt in history", async () => {
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "thread-4",
        title: "",
        preview: "Please summarize the latest release notes",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];

    await openHistory();

    expect(container.textContent).not.toContain(
      "Please summarize the latest release notes",
    );
  });

  it("pins an unpinned thread via the row action menu", async () => {
    await openHistory();

    const rows = container.querySelectorAll(".an-chat-history-row");
    const otherRow = rows[2];
    const trigger = otherRow.querySelector<HTMLButtonElement>(
      ".an-chat-history-row__menu-trigger",
    );
    await openRowMenu(trigger!);
    const pinItem = Array.from(
      document.body.querySelectorAll(".an-chat-history-row__menu-item"),
    ).find((el) => el.textContent?.includes("Pin to top"));
    expect(pinItem).toBeDefined();
    act(() => {
      (pinItem as HTMLButtonElement).click();
    });

    expect(threadMocks.pinThread).toHaveBeenCalledWith("thread-3", true);
  });

  it("unpins an already-pinned thread via the row action menu", async () => {
    await openHistory();

    const pinnedRow = container.querySelector(".an-chat-history-row");
    const trigger = pinnedRow!.querySelector<HTMLButtonElement>(
      ".an-chat-history-row__menu-trigger",
    );
    await openRowMenu(trigger!);
    const unpinItem = Array.from(
      document.body.querySelectorAll(".an-chat-history-row__menu-item"),
    ).find((el) => el.textContent?.includes("Unpin from top"));
    expect(unpinItem).toBeDefined();
    act(() => {
      (unpinItem as HTMLButtonElement).click();
    });

    expect(threadMocks.pinThread).toHaveBeenCalledWith("thread-2", false);
  });

  it("renames a thread via the row action menu", async () => {
    await openHistory();

    const rows = container.querySelectorAll(".an-chat-history-row");
    const activeRow = rows[1];
    const trigger = activeRow.querySelector<HTMLButtonElement>(
      ".an-chat-history-row__menu-trigger",
    );
    await openRowMenu(trigger!);
    const renameItem = Array.from(
      document.body.querySelectorAll(".an-chat-history-row__menu-item"),
    ).find((el) => el.textContent?.includes("Rename"));
    act(() => {
      (renameItem as HTMLButtonElement).click();
    });

    const input = activeRow.querySelector<HTMLInputElement>(
      ".an-chat-history-row__rename-input",
    );
    expect(input).not.toBeNull();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Renamed chat");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(threadMocks.renameThread).toHaveBeenCalledWith(
      "thread-1",
      "Renamed chat",
    );
  });

  it("does not render a delete row action (no confirm UX wired yet)", async () => {
    await openHistory();

    const trigger = container.querySelector<HTMLButtonElement>(
      ".an-chat-history-row__menu-trigger",
    );
    await openRowMenu(trigger!);

    const menuItems = Array.from(
      document.body.querySelectorAll(".an-chat-history-row__menu-item"),
    ).map((el) => el.textContent);
    expect(menuItems.length).toBeGreaterThan(0);
    expect(menuItems.some((text) => text?.includes("Delete"))).toBe(false);
  });
});
