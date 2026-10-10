// @vitest-environment happy-dom

import {
  AgentKitClient,
  AgentKitUploadError,
} from "@agent-native/agentkit/client";
import { MAX_AGENT_REQUEST_ATTACHMENT_DATA_CHARS } from "@agent-native/agentkit/protocol";
import type {
  FilePart,
  AgentMessage,
  AgentTransport,
} from "@agent-native/agentkit/protocol";
import { compareAndSetClientAppState } from "@agent-native/core/client/application-state";
import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSuggestionBar } from "../../composer/AgentSuggestionBar.js";

function largePngBytes(
  width = 2560,
  height = 1440,
  byteLength = 6_000_000,
): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const chatMocks = vi.hoisted(() => ({
  history: undefined as any,
  session: {
    authUserId: "user-1",
    email: "first@example.test",
    orgId: "workspace-1",
  },
  appState: new Map<string, unknown>(),
  composerDrafts: new Map<string, string>(),
  threadId: "thread-1",
  contextItems: [] as any[],
  renderEmptyState: false,
  pendingFiles: [] as File[],
  pendingReferences: [] as any[],
  readThread: () => chatMocks.thread,
  thread: {
    thread: null,
    messages: [] as any[],
    events: [] as any[],
    activeRunIds: [] as string[],
    runs: {} as Record<string, any>,
    approvals: {} as Record<string, any>,
    suggestions: [] as any[],
    tools: {} as Record<string, unknown>,
    activities: {} as Record<string, unknown>,
    queuedMessages: [] as any[],
  },
  history: null as any,
  rootProps: null as any,
  chatProps: null as any,
  composerProps: null as any,
  resumeProps: null as any,
  stuckBannerProps: null as any,
  failureProps: null as any,
  failurePropsHistory: [] as unknown[],
  loopLimitProps: null as any,
  failureError: { code: "test-error", message: "Run failed" } as any,
  failureCopies: 1,
  failureRunIds: ["run-1"] as string[],
  connectionError: null as any,
  setupCardProps: null as any,
  setupCardPropsHistory: [] as unknown[],
  providerGateProps: null as any,
  suggestionBarProps: null as any,
  dynamicSuggestionOptions: null as any,
  approvalRequest: null as any,
  approvalCardProps: null as any,
  reasoningProps: null as any,
  thinkingDisplay: null as any,
  requestComposerFocus: vi.fn(),
  persistThreadSnapshot: vi.fn(async () => undefined),
  readiness: { canChat: true, missing: false, state: "configured" },
  readinessOptions: null as unknown,
  fetchProviderState: vi.fn(async () => chatMocks.readiness.state),
  fileUploadStatus: {
    data: { configured: true },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  } as any,
  fileStoragePopoverProps: null as any,
  guidedFlowProps: null as any,
  guidedOptions: null as any,
  guidedQuestions: [] as any[],
  runtimeOptions: null as any,
  inBuilder: false,
  useRealRoot: false,
  realComposerController: null as AgentKitClient | null,
  useRealChat: false,
  omitSuggestionsSlot: false,
  voiceTranscriptRegistration: null as any,
  runtime: { kind: "runtime" },
  transport: { kind: "transport" },
  transportOptions: null as any,
  renderMarkdownToClipboardHtml: vi.fn(),
  writeClipboardText: vi.fn(),
  callAction: vi.fn(),
  control: {
    sendMessage: vi.fn(async () => undefined),
    queueMessage: vi.fn(async () => undefined),
    resolveConnectionRequest: vi.fn(async () => undefined),
    resolveApproval: vi.fn(async () => undefined),
    fork: vi.fn(async () => ({ id: "thread-forked" })),
    cancel: vi.fn(async () => undefined),
    uploadFiles: vi.fn(async () => []),
    reserveQueuedMessage: undefined as
      | ((text: string) => { id: string })
      | undefined,
    cancelQueuedMessageReservation: undefined as
      | ((messageId: string) => void)
      | undefined,
  },
  createRuntime: vi.fn((options: unknown) => {
    chatMocks.runtimeOptions = options;
    return chatMocks.runtime;
  }),
  createTransport: vi.fn((options: unknown) => {
    chatMocks.transportOptions = options;
    return chatMocks.transport;
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../agentkit/react/index.js", async () => {
  const React = await import("react");
  const { AgentKitChat, AgentKitComposer, AgentMessageView } =
    await import("../agentkit/react/components.js");
  const { useAgentKit, useAgentKitControl, useAgentThread } =
    await import("../agentkit/react/context.js");
  const { useThinkingDisplay } = await import("./thinking-display.js");
  return {
    AgentKitChat: (props: any) => {
      chatMocks.chatProps = props;
      chatMocks.thinkingDisplay = useThinkingDisplay();
      if (chatMocks.useRealChat)
        return React.createElement(AgentKitChat, props);
      const slots = chatMocks.rootProps?.slots;
      const Composer = slots?.composer;
      const EmptyState = slots?.emptyState;
      const Transcript = slots?.transcript;
      const Failure = slots?.runFailure;
      const ConnectionError = slots?.connectionError;
      const Approval = slots?.approval;
      const MessageSupplement = slots?.messageSupplement;
      return React.createElement(
        React.Fragment,
        null,
        Composer
          ? React.createElement(Composer, { threadId: chatMocks.threadId })
          : null,
        EmptyState && chatMocks.renderEmptyState
          ? React.createElement(EmptyState, { threadId: chatMocks.threadId })
          : null,
        Transcript
          ? React.createElement(
              "div",
              { className: "agentkit-transcript-content" },
              React.createElement(Transcript, {
                threadId: chatMocks.threadId,
                children: React.createElement("div", {
                  "data-testid": "first-transcript-message",
                }),
              }),
            )
          : null,
        Failure
          ? Array.from({ length: chatMocks.failureCopies }, (_, copy) =>
              React.createElement(Failure, {
                key: copy,
                error: chatMocks.failureError,
                runId: chatMocks.failureRunIds[copy] ?? "run-1",
                threadId: chatMocks.threadId,
              }),
            )
          : null,
        ConnectionError && chatMocks.connectionError
          ? React.createElement(ConnectionError, {
              error: chatMocks.connectionError,
              threadId: chatMocks.threadId,
              recover: vi.fn(),
              recovering: false,
              recoveryError: null,
            })
          : null,
        Approval && chatMocks.approvalRequest
          ? React.createElement(Approval, {
              value: chatMocks.approvalRequest,
              runId: "run-1",
              threadId: chatMocks.threadId,
            })
          : null,
        MessageSupplement
          ? chatMocks.thread.messages.map((value: any) =>
              React.createElement(MessageSupplement, {
                key: value.id,
                value,
                threadId: chatMocks.threadId,
              }),
            )
          : null,
      );
    },
    AgentKitComposer: (props: any) => {
      chatMocks.composerProps = props;
      React.useLayoutEffect(() => {
        if (chatMocks.realComposerController || !props.composerRef) return;
        props.composerRef.current = {
          submitWithText: async (text: string) => {
            if (props.onBeforeSubmit && !(await props.onBeforeSubmit()))
              return false;
            await props.onSubmit(
              text,
              chatMocks.pendingFiles,
              chatMocks.pendingReferences,
              {
                intent: "immediate",
                contextItems: props.contextItems,
              },
            );
            chatMocks.pendingFiles = [];
            chatMocks.pendingReferences = [];
            return true;
          },
        };
        return () => {
          props.composerRef.current = null;
        };
      });
      if (chatMocks.realComposerController) {
        return React.createElement(AgentKitComposer, props);
      }
      return React.createElement(
        "div",
        {
          "data-testid": "agentkit-composer",
        },
        props.extraActionButton,
      );
    },
    AgentApprovalPrompt: () => null,
    AgentMessageView: ({ value }: any) => {
      if (chatMocks.useRealChat)
        return React.createElement(AgentMessageView, {
          value,
          threadId: chatMocks.threadId,
        });
      const text = (value?.parts ?? [])
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join("\n");
      return React.createElement(
        "div",
        { "data-testid": "agent-message" },
        text,
      );
    },
    useAgentKit: () =>
      chatMocks.useRealChat
        ? useAgentKit()
        : {
            threadId: chatMocks.threadId,
            requestComposerFocus: chatMocks.requestComposerFocus,
            controller: {
              getThread: () => chatMocks.readThread(),
              persistThreadSnapshot: chatMocks.persistThreadSnapshot,
              assertAiSetupReady: async () => {
                const state = await chatMocks.fetchProviderState();
                if (state === "configured") return;
                throw Object.assign(
                  new Error("AI setup is required before sending."),
                  {
                    code: "AGENT_CHAT_AI_SETUP_REQUIRED",
                    state,
                  },
                );
              },
            },
          },
    useAgentKitControl: () =>
      chatMocks.useRealChat ? useAgentKitControl() : chatMocks.control,
    useAgentThread: () =>
      chatMocks.useRealChat ? useAgentThread() : chatMocks.readThread(),
  };
});

vi.mock("../agentkit/react/root.js", async () => {
  const React = await import("react");
  const { AgentKitProvider } = await import("../agentkit/react/context.js");
  const actual = await import("../agentkit/react/root.js");
  return {
    AgentKitRoot: (props: any) => {
      chatMocks.rootProps = props;
      if (chatMocks.useRealRoot) {
        return React.createElement(actual.AgentKitRoot, {
          ...props,
          ...(chatMocks.realComposerController
            ? {
                controller: chatMocks.realComposerController,
                transport: undefined,
                endpoint: undefined,
              }
            : {}),
        });
      }
      if (chatMocks.realComposerController) {
        return React.createElement(AgentKitProvider, {
          ...props,
          controller: chatMocks.realComposerController,
          slots: chatMocks.omitSuggestionsSlot
            ? { ...props.slots, suggestions: undefined }
            : props.slots,
        });
      }
      return chatMocks.useRealRoot
        ? React.createElement(actual.AgentKitRoot, props)
        : props.children;
    },
  };
});

vi.mock("@agent-native/toolkit/composer", async () => {
  const contextItems = await import("../../composer/context-items.js");
  const promptAttachments =
    await import("../../composer/prompt-attachments.js");
  return {
    AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES:
      promptAttachments.AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES,
    readAgentPromptAttachment: promptAttachments.readAgentPromptAttachment,
    snapshotComposerContextItems: contextItems.snapshotComposerContextItems,
    composerContextFits: contextItems.composerContextFits,
    AgentSuggestionBar: (props: any) => {
      chatMocks.suggestionBarProps = props;
      if (chatMocks.realComposerController) {
        return React.createElement(AgentSuggestionBar, props);
      }
      return React.createElement(
        "div",
        {
          "data-testid": "agentkit-suggestion-bar",
          className: (props as { className?: string }).className,
        },
        props.suggestions.map((suggestion: any) =>
          React.createElement(
            "button",
            {
              key: suggestion.id,
              disabled: suggestion.disabled,
              onClick: () => props.onSelect(suggestion),
            },
            suggestion.label,
          ),
        ),
      );
    },
    agentSuggestionPrompt: (suggestion: any) =>
      typeof suggestion === "string" ? suggestion : suggestion.prompt,
  };
});

vi.mock(
  "@agent-native/toolkit/composer/realtime-voice-transcript",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@agent-native/toolkit/composer/realtime-voice-transcript")
      >();
    return {
      ...actual,
      realtimeVoiceTranscriptRegistry: {
        ...actual.realtimeVoiceTranscriptRegistry,
        register: (registration: unknown) => {
          chatMocks.voiceTranscriptRegistration = registration;
          return () => {
            if (chatMocks.voiceTranscriptRegistration === registration) {
              chatMocks.voiceTranscriptRegistration = null;
            }
          };
        },
      },
    };
  },
);

vi.mock("@agent-native/toolkit/agentkit", async (importOriginal) => {
  const { PromptComposer } = await import("../../composer/PromptComposer.js");
  return {
    ...(await importOriginal<
      typeof import("@agent-native/toolkit/agentkit")
    >()),
    PromptComposer: (props: React.ComponentProps<typeof PromptComposer>) =>
      chatMocks.useRealChat ? React.createElement(PromptComposer, props) : null,
  };
});

vi.mock("@tabler/icons-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tabler/icons-react")>()),
  ...Object.fromEntries(
    [
      "IconAlertTriangle",
      "IconCheck",
      "IconChevronDown",
      "IconLoader2",
      "IconMessage",
      "IconPlayerStopFilled",
      "IconQuote",
      "IconRefresh",
      "IconShieldCheck",
      "IconX",
    ].map((name) => [name, () => null]),
  ),
}));

vi.mock("./agentkit-chat/history.js", async () => {
  const React = await import("react");
  return {
    AgentKitDevCheckpointProvider: ({ children }: any) =>
      React.createElement(React.Fragment, null, children),
    AgentKitDevCheckpointRestore: () => null,
    useOptionalAgentKitHistory: () => chatMocks.history,
  };
});

vi.mock("./agentkit-chat/index.js", async () => {
  const React = await import("react");
  const { ComposerRuntimeAdaptersProvider } =
    await import("../../composer/runtime-adapters.js");
  return {
    CoreComposerRuntimeProvider: ({ children }: any) =>
      React.createElement(
        ComposerRuntimeAdaptersProvider,
        {
          adapters: {
            models: {
              useChatModels: () => ({
                selectedModel: "auto",
                selectedEngine: "openai",
                selectedEffort: "medium",
                availableModels: [],
                isLoading: false,
                onModelChange: () => {},
                onEffortChange: () => {},
              }),
              useAgentEngineConfigured: () => chatMocks.readiness,
              fetchAgentEngineConfiguredState: async () =>
                chatMocks.fetchProviderState(),
            },
          },
        },
        children,
      ),
    createAgentNativeAgentKitTransport: chatMocks.createTransport,
    findMcpConnectionSuggestionIntegration: () => null,
    GuidedQuestionProviderGate: (props: any) => {
      chatMocks.providerGateProps = props;
      return React.createElement(
        "div",
        { "data-testid": "provider-status-gate" },
        React.createElement(
          "span",
          null,
          props.modelListUnavailable
            ? "agentChat.setup.modelListUnavailable"
            : "agentChat.setup.providerStatusUnavailable",
        ),
        React.createElement(
          "button",
          { type: "button", onClick: props.onRetry },
          "Retry",
        ),
      );
    },
    GuidedQuestionFlow: (props: unknown) => {
      chatMocks.guidedFlowProps = props;
      return null;
    },
    McpAgentKitConnectionRequestCard: () => null,
    McpAgentKitConnectionResume: (props: unknown) => {
      chatMocks.resumeProps = props;
      return null;
    },
    McpConnectionSuggestion: () => null,
    AgentKitHistoryBeginningRevert: () =>
      React.createElement("div", {
        "data-testid": "history-beginning-revert",
      }),
    AgentKitHistoryMessageSupplement: () => null,
    AgentKitHistoryProvider: ({ children }: any) =>
      React.createElement(React.Fragment, null, children),
    useGuidedQuestionFlow: (options: unknown) => {
      chatMocks.guidedOptions = options;
      return { questions: chatMocks.guidedQuestions };
    },
  };
});

vi.mock("./agentkit-chat/parity-renderers.js", () => ({
  AgentKitFilesChangedSummary: () => null,
  AgentKitMarkdownText: () => null,
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(
    async (key: string, expected: unknown, next: unknown) => {
      const current = chatMocks.appState.get(key) ?? null;
      if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
      if (next === null) chatMocks.appState.delete(key);
      else chatMocks.appState.set(key, next);
      return true;
    },
  ),
  deleteClientAppState: vi.fn(async (key: string) => {
    chatMocks.appState.delete(key);
  }),
  isClientAppStateMutationPending: vi.fn(() => false),
  readClientAppState: vi.fn(
    async (key: string) => chatMocks.appState.get(key) ?? null,
  ),
  writeClientAppState: vi.fn(async (key: string, value: unknown) => {
    chatMocks.appState.set(key, value);
    return value;
  }),
}));

vi.mock("@agent-native/core/client/host", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/host")>();
  return { ...actual, isInBuilderFrame: () => chatMocks.inBuilder };
});

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/client/agent-chat")
    >();
  return {
    ...actual,
    readAssistantChatComposerDraft: (key: string) =>
      chatMocks.composerDrafts.get(key) ?? null,
    writeAssistantChatComposerDraft: vi.fn((key: string, text: string) => {
      chatMocks.composerDrafts.set(key, text);
    }),
    createAgentNativeChatRuntime: chatMocks.createRuntime,
    useAgentDynamicSuggestionsResult: (options: unknown) => {
      chatMocks.dynamicSuggestionOptions = options;
      return {
        suggestions: (options as { staticSuggestions?: string[] })
          .staticSuggestions,
      };
    },
    ExternalAgentNudge: () => null,
    useDevMode: () => ({ isDevMode: true }),
    useAgentEngineConfigured: (_enabled: boolean, options?: unknown) => {
      chatMocks.readinessOptions = options;
      return chatMocks.readiness;
    },
    fetchAgentEngineConfiguredState: chatMocks.fetchProviderState,
    isLocalRuntimeEngine: (engine?: string) =>
      ["codex-cli", "claude-cli", "pi-cli", "opencode-cli"].includes(
        engine ?? "",
      ),
    filterAgentChatContextItems: actual.filterAgentChatContextItems,
    formatAgentChatContextItemsForPrompt:
      actual.formatAgentChatContextItemsForPrompt,
    getAgentChatContextState: () => ({
      items: chatMocks.contextItems,
      updatedAt: 0,
    }),
    publishAgentChatContextItems: vi.fn((items: unknown[]) => {
      chatMocks.contextItems = items;
    }),
    setAgentChatContextItemAndPersist: async (item: unknown) => {
      await actual.setAgentChatContextItemAndPersist(
        item as Parameters<typeof actual.setAgentChatContextItemAndPersist>[0],
      );
      chatMocks.contextItems = actual.getAgentChatContextState().items;
    },
    removeAgentChatContextItemAndPersist: async (key: string) => {
      await actual.removeAgentChatContextItemAndPersist(key);
      chatMocks.contextItems = actual.getAgentChatContextState().items;
    },
    refreshAgentChatContext: vi.fn(async () => undefined),
    subscribeAgentChatContext: vi.fn(() => () => undefined),
  };
});

vi.mock("./chat/run-recovery.js", async (importOriginal) => ({
  isMissingLlmProviderRunError: (
    await importOriginal<typeof import("./chat/run-recovery.js")>()
  ).isMissingLlmProviderRunError,
  RunErrorRecoveryCard: (props: unknown) => {
    chatMocks.failureProps = props;
    chatMocks.failurePropsHistory.push(props);
    return React.createElement("div", {
      "data-testid": "run-error-recovery-card",
    });
  },
  BuilderSetupCard: (props: unknown) => {
    chatMocks.setupCardProps = props;
    chatMocks.setupCardPropsHistory.push(props);
    return React.createElement("div", { "data-testid": "builder-setup-card" });
  },
  LoopLimitContinueCard: (props: unknown) => {
    chatMocks.loopLimitProps = props;
    return null;
  },
  PlanModeCallout: () => null,
  getRequestModeMetadata: () => undefined,
}));

vi.mock("./FileStorageSetupPopover.js", async () => {
  const React = await import("react");
  return {
    FileStorageSetupPopover: (props: unknown) => {
      chatMocks.fileStoragePopoverProps = props;
      return React.createElement("div", {
        "data-testid": "file-storage-setup-popover",
      });
    },
  };
});

vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => chatMocks.fileUploadStatus,
}));

vi.mock("./chat/markdown-renderer.js", () => ({
  renderMarkdownToClipboardHtml: chatMocks.renderMarkdownToClipboardHtml,
}));

vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText: chatMocks.writeClipboardText,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatNumber: String,
    formatDate: (value: string | Date) =>
      value instanceof Date ? value.toISOString() : value,
  }),
  useT: () => (key: string, options?: Record<string, unknown>) =>
    key === "agentChat.composer.previewAttachment"
      ? `Preview ${String(options?.name ?? "{{name}}")}`
      : key === "agentChat.errorMessages.invalidAttachmentNamed"
        ? `${key}:${String(options?.name ?? "{{name}}")}`
        : key,
}));

vi.mock("./RunStuckBanner.js", () => ({
  RunStuckBanner: (props: unknown) => {
    chatMocks.stuckBannerProps = props;
    return null;
  },
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return { ...actual, callAction: chatMocks.callAction, signOut: vi.fn() };
});

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: chatMocks.session, status: "authenticated" }),
}));

vi.mock("./chat/tool-call-display.js", async () => {
  const React = await import("react");
  return {
    ChatRunningContext: React.createContext(false),
    SuppressInlineOpenAppContext: React.createContext(false),
    ToolCallDisplay: () => null,
    AgentApprovalCard: (props: any) => {
      chatMocks.approvalCardProps = props;
      return React.createElement(
        "div",
        null,
        React.createElement(
          "button",
          { type: "button", onClick: props.onDeny },
          props.denyLabel,
        ),
        props.onAlwaysAllow
          ? React.createElement(
              "button",
              { type: "button", onClick: props.onAlwaysAllow },
              props.alwaysAllowLabel,
            )
          : null,
      );
    },
    ReasoningCell: (props: any) => {
      chatMocks.reasoningProps = props;
      return React.createElement(
        "div",
        { "data-default-open": String(props.defaultOpen) },
        props.text,
      );
    },
  };
});

vi.mock("./chat/agent-approval-card.js", async () => {
  const React = await import("react");
  return {
    AgentApprovalCard: (props: any) => {
      chatMocks.approvalCardProps = props;
      return React.createElement(
        "div",
        null,
        React.createElement(
          "button",
          { type: "button", onClick: props.onDeny },
          props.denyLabel,
        ),
        props.onAlwaysAllow
          ? React.createElement(
              "button",
              { type: "button", onClick: props.onAlwaysAllow },
              props.alwaysAllowLabel,
            )
          : null,
      );
    },
  };
});

import {
  AGENT_CHAT_SUBMIT_RESULT_EVENT,
  appendAgentChatContextToMessage,
  createAgentNativeAgentKitTransport,
} from "@agent-native/core/client/agent-chat";
import {
  deleteClientAppState,
  readClientAppState,
} from "@agent-native/core/client/application-state";

import { AgentKitActionWidget } from "./agentkit-chat/action-widget.js";
import {
  AgentKitAssistantChat,
  agentMessageTextFromParts,
  updateDeferredProviderSubmissions,
  type AgentKitAssistantChatProps,
} from "./AgentKitAssistantChat.js";
import type {
  AssistantChatComposerContext,
  AssistantChatComposerContextProviderProps,
  AssistantChatHandle,
  AssistantChatSendOptions,
} from "./chat/surface-types.js";

let container: HTMLDivElement;
let root: Root;

class TestErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    onError: (error: Error) => void;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

async function mount(
  props: AgentKitAssistantChatProps,
  ref?: React.Ref<AssistantChatHandle>,
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<AgentKitAssistantChat {...props} ref={ref} />);
  });
}

async function unmount() {
  if (!root) return;
  await act(async () => root.unmount());
  container.remove();
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function baseProps(
  overrides: Partial<AgentKitAssistantChatProps> = {},
): AgentKitAssistantChatProps {
  return {
    threadId: chatMocks.threadId,
    isNewThread: true,
    ...overrides,
  };
}

beforeEach(() => {
  chatMocks.history = undefined;
  chatMocks.session = {
    authUserId: "user-1",
    email: "first@example.test",
    orgId: "workspace-1",
  };
  vi.mocked(readClientAppState)
    .mockReset()
    .mockImplementation(async (key) => chatMocks.appState.get(key) ?? null);
  vi.mocked(deleteClientAppState)
    .mockReset()
    .mockImplementation(async (key) => {
      chatMocks.appState.delete(key);
    });
  chatMocks.appState.clear();
  chatMocks.composerDrafts.clear();
  chatMocks.threadId = "thread-1";
  chatMocks.contextItems = [];
  chatMocks.renderEmptyState = false;
  chatMocks.pendingFiles = [];
  chatMocks.pendingReferences = [];
  chatMocks.thread = {
    thread: null,
    messages: [],
    events: [],
    activeRunIds: [],
    runs: {},
    approvals: {},
    suggestions: [],
    tools: {},
    activities: {},
    queuedMessages: [],
  };
  chatMocks.history = null;
  chatMocks.readThread = () => chatMocks.thread;
  chatMocks.rootProps = null;
  chatMocks.chatProps = null;
  chatMocks.composerProps = null;
  chatMocks.resumeProps = null;
  chatMocks.stuckBannerProps = null;
  chatMocks.failureProps = null;
  chatMocks.failurePropsHistory = [];
  chatMocks.loopLimitProps = null;
  chatMocks.failureError = { code: "test-error", message: "Run failed" };
  chatMocks.failureCopies = 1;
  chatMocks.failureRunIds = ["run-1"];
  chatMocks.connectionError = null;
  chatMocks.readinessOptions = null;
  chatMocks.setupCardProps = null;
  chatMocks.setupCardPropsHistory = [];
  chatMocks.providerGateProps = null;
  chatMocks.suggestionBarProps = null;
  chatMocks.dynamicSuggestionOptions = null;
  chatMocks.approvalRequest = null;
  chatMocks.approvalCardProps = null;
  chatMocks.reasoningProps = null;
  chatMocks.thinkingDisplay = null;
  chatMocks.requestComposerFocus.mockReset();
  chatMocks.persistThreadSnapshot.mockReset().mockResolvedValue(undefined);
  chatMocks.readiness = {
    canChat: true,
    missing: false,
    state: "configured",
  };
  chatMocks.fetchProviderState
    .mockReset()
    .mockImplementation(async () => chatMocks.readiness.state);
  chatMocks.fileUploadStatus = {
    data: { configured: true },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  };
  chatMocks.fileStoragePopoverProps = null;
  chatMocks.guidedFlowProps = null;
  chatMocks.guidedOptions = null;
  chatMocks.guidedQuestions = [];
  chatMocks.runtimeOptions = null;
  chatMocks.transportOptions = null;
  chatMocks.inBuilder = false;
  chatMocks.useRealRoot = false;
  chatMocks.realComposerController = null;
  chatMocks.useRealChat = false;
  chatMocks.omitSuggestionsSlot = false;
  chatMocks.voiceTranscriptRegistration = null;
  chatMocks.control.sendMessage.mockReset().mockResolvedValue(undefined);
  chatMocks.control.queueMessage.mockReset().mockResolvedValue(undefined);
  chatMocks.control.resolveConnectionRequest
    .mockReset()
    .mockResolvedValue(undefined);
  chatMocks.control.resolveApproval.mockReset().mockResolvedValue(undefined);
  chatMocks.control.fork.mockReset().mockResolvedValue({ id: "thread-forked" });
  chatMocks.control.uploadFiles.mockReset().mockResolvedValue([]);
  chatMocks.control.reserveQueuedMessage = undefined;
  chatMocks.control.cancelQueuedMessageReservation = undefined;
  chatMocks.createRuntime.mockClear();
  chatMocks.createTransport
    .mockReset()
    .mockImplementation((options: unknown) => {
      chatMocks.transportOptions = options;
      return chatMocks.transport;
    });
  chatMocks.renderMarkdownToClipboardHtml
    .mockReset()
    .mockReturnValue("<p><strong>Ready</strong></p>");
  chatMocks.writeClipboardText.mockReset().mockResolvedValue(true);
  chatMocks.callAction.mockReset().mockResolvedValue(null);
});

afterEach(async () => {
  await unmount();
  chatMocks.realComposerController?.dispose();
  window.sessionStorage.clear();
});

describe("AgentKitAssistantChat host behavior", () => {
  it("reports whether a composer can hold a prefill with its current context", async () => {
    const ref = createRef<AssistantChatHandle>();
    await mount(baseProps(), ref);

    expect(
      ref.current!.canStageComposerContextItem({
        key: "agent-chat-prefill-context",
        title: "Selected rows",
        context: "Selected rows: a, b",
      }),
    ).toBe(true);
    expect(
      ref.current!.canStageComposerContextItem({
        key: "agent-chat-prefill-context",
        title: "Selected rows",
        context: "x".repeat(64 * 1024 + 1),
      }),
    ).toBe(false);
  });

  it("keeps a replacement prefill staged while an earlier send was in flight", async () => {
    const ref = createRef<AssistantChatHandle>();
    await mount(baseProps(), ref);
    const stage = (context: string) =>
      act(async () =>
        ref.current!.setComposerContextItem(
          {
            key: "agent-chat-prefill-context",
            title: "Selected rows",
            context,
          },
          { focus: false, threadScoped: true },
        ),
      );
    await stage("Selected rows: a, b");
    let finishSend: (value: unknown) => void = () => {};
    chatMocks.control.sendMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSend = resolve;
        }),
    );
    await act(async () => {
      void chatMocks.composerProps.onSubmit("Tell me more", [], [], {
        intent: "immediate",
      });
    });

    await stage("Selected rows: c, d");
    await act(async () => finishSend(undefined));

    expect(chatMocks.composerProps.contextItems).toEqual([
      expect.objectContaining({
        key: "agent-chat-prefill-context:thread-1",
        context: "Selected rows: c, d",
      }),
    ]);
  });

  it("uses the action widget renderer for action chat UI output", async () => {
    await mount(baseProps());

    expect(chatMocks.rootProps.slots.widget).toBe(AgentKitActionWidget);
  });

  it("checks readiness on the configured chat API server", async () => {
    await mount(
      baseProps({
        apiUrl: "https://clips.example.test/_agent-native/agent-chat",
      }),
    );

    expect(chatMocks.readinessOptions).toMatchObject({
      source: {
        statusUrl:
          "https://clips.example.test/_agent-native/agent-engine/status",
        credentials: "include",
      },
    });
  });

  it("asks for a title on the engine and model the first prompt was sent with", async () => {
    const onGenerateTitle = vi.fn();
    const props = baseProps({ onGenerateTitle });
    await mount(props);

    chatMocks.thread = {
      ...chatMocks.thread,
      messages: [
        {
          id: "message-user-1",
          role: "user",
          parts: [{ type: "text", text: "Write forty lines" }],
          metadata: { engine: "ai-sdk:openai", model: "gpt-5.6-luna" },
        },
      ],
    };
    await act(async () => {
      root.render(<AgentKitAssistantChat {...props} />);
    });

    expect(onGenerateTitle).toHaveBeenCalledWith(
      chatMocks.threadId,
      "Write forty lines",
      { engine: "ai-sdk:openai", model: "gpt-5.6-luna" },
    );
  });

  it("uses a sanitized first-message fallback when the thread title is blank", async () => {
    const savedSnapshots = vi.fn();
    const message = {
      id: "message-user-title-fallback",
      role: "user",
      status: "complete",
      createdAt: "2026-10-07T12:00:00.000Z",
      parts: [
        {
          type: "text",
          text: appendAgentChatContextToMessage(
            "Summarize @[the sprint|resource:123] <context>",
            "Private context",
          ),
        },
      ],
    };
    chatMocks.thread = {
      ...chatMocks.thread,
      thread: {
        id: chatMocks.threadId,
        title: "",
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      },
      messages: [message],
      events: [],
      activeRunIds: [],
      runs: {},
      approvals: {},
      approvalRunIds: {},
      connectionRequests: {},
      connectionRequestRunIds: {},
      tools: {},
      activities: {},
      queuedMessages: [],
      tasks: {},
      taskGroups: {},
      widgets: {},
      widgetMessageIds: {},
      annotations: {},
      annotationMessageIds: {},
      agents: {},
      agentInteractions: [],
      artifacts: [],
    };

    const props = baseProps({
      onSaveThread: savedSnapshots,
      runtime: {} as never,
    });
    await mount(props);
    await act(async () => root.render(null));

    expect(savedSnapshots).toHaveBeenCalledWith(
      chatMocks.threadId,
      expect.objectContaining({
        title: "Summarize @the sprint <context>",
        preview: "Summarize @[the sprint|resource:123] <context>",
      }),
    );
  });

  it("strips ambiguous text between legacy blocks across raw message parts", async () => {
    const savedSnapshots = vi.fn();
    const messageParts: AgentMessage["parts"] = [
      {
        type: "text",
        text: "Summarize sprint <context>private first</context>ambiguous private",
      },
      {
        type: "text",
        text: " gap<context>private second</context> visible continuation",
      },
    ];
    const message = {
      id: "message-user-legacy-context",
      role: "user",
      status: "complete",
      createdAt: "2026-10-07T12:00:00.000Z",
      parts: messageParts,
    };
    chatMocks.thread = {
      ...chatMocks.thread,
      thread: {
        id: chatMocks.threadId,
        title: "",
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      },
      messages: [message],
      events: [],
      activeRunIds: [],
      runs: {},
      approvals: {},
      approvalRunIds: {},
      connectionRequests: {},
      connectionRequestRunIds: {},
      tools: {},
      activities: {},
      queuedMessages: [],
      tasks: {},
      taskGroups: {},
      widgets: {},
      widgetMessageIds: {},
      annotations: {},
      annotationMessageIds: {},
      agents: {},
      agentInteractions: [],
      artifacts: [],
    };

    const props = baseProps({
      onSaveThread: savedSnapshots,
      runtime: {} as never,
    });
    await mount(props);
    await act(async () => root.render(null));

    expect(agentMessageTextFromParts(messageParts)).toBe(
      "Summarize sprint  visible continuation",
    );
    expect(savedSnapshots).toHaveBeenCalledWith(
      chatMocks.threadId,
      expect.objectContaining({
        title: "Summarize sprint visible continuation",
        preview: "Summarize sprint  visible continuation",
      }),
    );
    expect(savedSnapshots.mock.calls[0]?.[1].preview).not.toContain(
      "ambiguous private",
    );
  });

  it("shows a retry when chat history fails to load", async () => {
    const retryHistory = vi.fn();
    chatMocks.history = {
      historyLoadFailed: true,
      isRetryingHistory: false,
      retryHistory,
    };

    await mount(baseProps());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "agentChat.message.historyUnavailable",
    );
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "agentChat.common.retry",
    );
    expect(retry).toBeDefined();

    await act(async () => retry?.click());

    expect(retryHistory).toHaveBeenCalledOnce();
  });

  it("shows Thinking in the transcript while a submitted user message is pending", async () => {
    chatMocks.history = { isSubmissionInFlight: true };
    chatMocks.thread.messages = [
      {
        id: "user-pending",
        role: "user",
        parts: [{ type: "text", text: "Summarize my inbox" }],
        metadata: {},
      },
    ];
    await mount(baseProps());

    const thinking = container.querySelector('[role="status"]');
    expect(thinking?.textContent).toBe("agentChat.status.thinking");
    expect(
      thinking?.querySelector(
        "[data-agentkit-current-activity] .agent-running-shimmer",
      ),
    ).not.toBeNull();
    expect(chatMocks.composerProps.disabled).toBe(false);
    expect(chatMocks.composerProps.submissionDisabled).toBe(true);
    expect(chatMocks.composerProps.announcePendingSubmission).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "agentChat.status.thinking",
    );
    expect(
      container.querySelector("[data-agentkit-active-run-id-copy]"),
    ).toBeNull();
  });

  it("copies the active run ID from its action menu", async () => {
    const props = baseProps();
    await mount(props);

    expect(
      container.querySelector("[data-agentkit-active-run-id-copy]"),
    ).toBeNull();

    chatMocks.thread = { ...chatMocks.thread, activeRunIds: ["run-active"] };
    await act(async () => root.render(<AgentKitAssistantChat {...props} />));

    const actions = container.querySelector(
      "[data-agentkit-active-run-id-copy]",
    );
    const actionsTrigger = actions?.querySelector(
      'button[aria-label="agentChat.message.actions"]',
    );
    expect(actionsTrigger).toBeTruthy();
    expect(actionsTrigger?.getAttribute("aria-haspopup")).toBe("menu");
    expect(
      actions?.querySelector(
        'button[aria-label="agentChat.message.copyRequestId"]',
      ),
    ).toBeNull();

    await act(async () => {
      actionsTrigger?.focus();
      actionsTrigger?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
      await Promise.resolve();
    });

    const menuItems = Array.from(
      document.body.querySelectorAll('[role="menuitem"]'),
    );
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      "agentChat.message.copyRequestId",
    ]);

    await act(async () => {
      menuItems[0]?.click();
      await Promise.resolve();
    });

    expect(chatMocks.writeClipboardText).toHaveBeenCalledWith("run-active");
    const copiedFeedback = container.querySelector(
      '[data-agentkit-active-run-id-copy] [role="status"]',
    );
    expect(copiedFeedback?.textContent).toContain("agentChat.common.copied");
    expect(copiedFeedback?.classList.contains("sr-only")).toBe(false);

    chatMocks.writeClipboardText.mockResolvedValueOnce(false);
    await act(async () => {
      actionsTrigger?.focus();
      actionsTrigger?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
      await Promise.resolve();
    });
    const retryMenuItem = document.body.querySelector('[role="menuitem"]');
    await act(async () => {
      retryMenuItem?.click();
      await Promise.resolve();
    });
    const failedFeedback = container.querySelector(
      '[data-agentkit-active-run-id-copy] [role="alert"]',
    );
    expect(failedFeedback?.textContent).toContain(
      "agentChat.recovery.copyFailed",
    );
    expect(failedFeedback?.classList.contains("sr-only")).toBe(false);
    expect(
      failedFeedback?.classList.contains(
        "agentkit-active-run-actions-feedback-error",
      ),
    ).toBe(true);
  });

  it("does not duplicate Thinking after the run becomes active", async () => {
    chatMocks.history = { isSubmissionInFlight: true };
    chatMocks.thread.activeRunIds = ["run-active"];
    chatMocks.thread.messages = [
      {
        id: "user-pending",
        role: "user",
        parts: [{ type: "text", text: "Summarize my inbox" }],
        metadata: {},
      },
    ];
    await mount(baseProps());

    expect(container.querySelector(".agent-thinking-indicator")).toBeNull();
  });

  it("keeps the pending announcement when the transcript has no visible user message", async () => {
    chatMocks.history = { isSubmissionInFlight: true };
    chatMocks.thread.messages = [
      {
        id: "assistant-last",
        role: "assistant",
        parts: [{ type: "text", text: "Earlier response" }],
      },
    ];
    await mount(baseProps());

    expect(chatMocks.composerProps.announcePendingSubmission).toBe(true);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("gives JS callers a migration error for the removed createAdapter prop", async () => {
    const errors: Error[] = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const props = {
      ...baseProps(),
      createAdapter: vi.fn(),
    } as unknown as AgentKitAssistantChatProps;

    await act(async () => {
      root.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <AgentKitAssistantChat {...props} />
        </TestErrorBoundary>,
      );
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("createAdapter prop was removed");
    expect(errors[0]?.message).toContain("agentkit-chat.md");
  });

  function seedFollowup() {
    const suggestion = {
      id: "refine",
      runId: "run-1",
      label: "Refine layout",
      prompt: "Refine the selected design using the agreed responsive layout.",
      metadata: { context: "Use the selected design's spacing decisions." },
    };
    Object.assign(chatMocks.thread, {
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Create a design" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          status: "complete",
          parts: [{ type: "text", text: "Created." }],
        },
      ],
      runs: { "run-1": { id: "run-1", status: "completed", lastSequence: 3 } },
      suggestions: [suggestion],
      suggestionsUserMessageId: "user-1",
    });
    return suggestion;
  }

  async function useRealComposer(
    startRun: AgentTransport["startRun"] = vi.fn(),
    transportOverrides: Partial<AgentTransport> = {},
  ) {
    const at = "2026-09-28T00:00:00.000Z";
    const subscribeToRun =
      transportOverrides.subscribeToRun ?? async function* () {};
    const client = new AgentKitClient({
      transport: {
        ...transportOverrides,
        capabilities: {
          suggestions: true,
          ...transportOverrides.capabilities,
        },
        getThreadSnapshot: async ({ threadId }) => ({
          id: threadId,
          createdAt: at,
          updatedAt: at,
          messages: chatMocks.thread.messages,
          runs: Object.values(chatMocks.thread.runs).map((run) => ({
            ...run,
            threadId,
            startedAt: at,
            completedAt: at,
          })),
          suggestions: chatMocks.thread.suggestions,
        }),
        startRun,
        subscribeToRun,
        assertAiSetupReady: async () => undefined,
        cancelRun: transportOverrides.cancelRun ?? (async () => {}),
      },
    });
    await client.loadThread(chatMocks.threadId);
    chatMocks.realComposerController = client;
    chatMocks.readThread = () => client.getThread(chatMocks.threadId);
    return client;
  }

  it("queues a real composer submission while a run is active", async () => {
    const at = "2026-09-28T00:00:00.000Z";
    const activeRunFinished = Promise.withResolvers<void>();
    const startRun = vi.fn<AgentTransport["startRun"]>(async () => ({
      runId: "run-active",
    }));
    const queueMessage = vi.fn<NonNullable<AgentTransport["queueMessage"]>>(
      async ({ threadId, text }) => ({
        message: {
          id: "queued-1",
          threadId,
          text,
          createdAt: at,
        },
      }),
    );
    chatMocks.useRealChat = true;
    chatMocks.useRealRoot = true;
    const client = await useRealComposer(startRun, {
      capabilities: { messageQueue: true },
      queueMessage,
      async *subscribeToRun({ threadId, runId }) {
        await activeRunFinished.promise;
        yield {
          id: "event-run-completed",
          type: "run.completed",
          threadId,
          runId,
          sequence: 1,
          occurredAt: at,
        };
      },
    });

    try {
      await client.sendMessage({
        threadId: chatMocks.threadId,
        text: "Current turn",
      });
      expect(client.getThread(chatMocks.threadId).activeRunIds).toEqual([
        "run-active",
      ]);

      await mount(baseProps({ showModelSelector: false }));
      const composer = chatMocks.composerProps.composerRef.current;
      await act(async () => composer.setText("Next turn"));
      const send = container.querySelector<HTMLButtonElement>(
        '[data-agent-composer-slot="send-button"]',
      )!;
      expect(send.disabled).toBe(false);

      await act(async () => send.click());

      expect(queueMessage).toHaveBeenCalledOnce();
      expect(queueMessage.mock.calls[0]?.[0]).toMatchObject({
        threadId: chatMocks.threadId,
        text: "Next turn",
      });
      expect(startRun).toHaveBeenCalledOnce();
      expect(client.getThread(chatMocks.threadId).queuedMessages).toEqual([
        expect.objectContaining({ text: "Next turn" }),
      ]);
    } finally {
      activeRunFinished.resolve();
      await flush();
    }
  });

  it("shows queued text before deferred readiness and attachment upload finish", async () => {
    const at = "2026-10-09T00:00:00.000Z";
    const activeRunFinished = Promise.withResolvers<void>();
    const readiness = Promise.withResolvers<void>();
    const readinessStarted = Promise.withResolvers<void>();
    const upload = Promise.withResolvers<FilePart[]>();
    const uploadStarted = Promise.withResolvers<void>();
    const startRun = vi.fn<AgentTransport["startRun"]>(async () => ({
      runId: "run-active",
    }));
    const queueMessage = vi.fn<NonNullable<AgentTransport["queueMessage"]>>(
      async ({ id, threadId, text, attachments }) => ({
        message: {
          id: id ?? "queued-prepared",
          threadId,
          text,
          createdAt: at,
          attachments,
        },
      }),
    );
    chatMocks.useRealChat = true;
    chatMocks.useRealRoot = true;
    const client = await useRealComposer(startRun, {
      capabilities: {
        attachments: true,
        messageQueue: true,
        uploads: true,
      },
      queueMessage,
      async *subscribeToRun({ threadId, runId }) {
        await activeRunFinished.promise;
        yield {
          id: "event-run-completed",
          type: "run.completed",
          threadId,
          runId,
          sequence: 1,
          occurredAt: at,
        };
      },
    });

    vi.spyOn(client, "uploadFiles").mockImplementation(async () => {
      uploadStarted.resolve();
      return upload.promise;
    });

    try {
      await client.sendMessage({
        threadId: chatMocks.threadId,
        text: "Current turn",
      });
      await mount(baseProps({ showModelSelector: false }));
      vi.spyOn(client, "assertAiSetupReady").mockImplementation(async () => {
        readinessStarted.resolve();
        await readiness.promise;
      });

      let submission!: Promise<unknown>;
      await act(async () => {
        submission = chatMocks.composerProps.onSubmit(
          "Next turn",
          [new File(["notes"], "notes.txt", { type: "text/plain" })],
          [],
          { intent: "queued" },
        );
        await Promise.resolve();
      });

      await readinessStarted.promise;
      const staged = client.getThread(chatMocks.threadId).queuedMessages;
      expect(staged).toEqual([expect.objectContaining({ text: "Next turn" })]);
      expect(staged[0]).not.toHaveProperty("attachments");
      expect(queueMessage).not.toHaveBeenCalled();

      readiness.resolve();
      await uploadStarted.promise;
      expect(client.getThread(chatMocks.threadId).queuedMessages).toEqual([
        expect.objectContaining({ id: staged[0]?.id, text: "Next turn" }),
      ]);
      expect(queueMessage).not.toHaveBeenCalled();

      upload.resolve([
        {
          type: "file",
          name: "notes.txt",
          mediaType: "text/plain",
          url: "https://files.example.test/notes.txt",
        },
      ]);
      await act(async () => submission);

      expect(queueMessage).toHaveBeenCalledOnce();
      expect(queueMessage.mock.calls[0]?.[0]).toMatchObject({
        id: staged[0]?.id,
        text: "Next turn",
        attachments: [
          {
            type: "file",
            name: "notes.txt",
            url: "https://files.example.test/notes.txt",
          },
        ],
      });
    } finally {
      readiness.resolve();
      upload.resolve([]);
      activeRunFinished.resolve();
      await flush();
    }
  });

  it("uses Cmd-click to steer an active run without a second run-slot send", async () => {
    const at = "2026-09-28T00:00:00.000Z";
    const activeRunFinished = Promise.withResolvers<void>();
    const startRun = vi.fn<AgentTransport["startRun"]>(async () => ({
      runId: "run-active",
    }));
    const queueMessage = vi.fn<NonNullable<AgentTransport["queueMessage"]>>(
      async ({ threadId, text }) => ({
        message: {
          id: "queued-steer",
          threadId,
          text,
          createdAt: at,
        },
      }),
    );
    const steerQueuedMessage = vi.fn<
      NonNullable<AgentTransport["steerQueuedMessage"]>
    >(async () => undefined);
    chatMocks.useRealChat = true;
    chatMocks.useRealRoot = true;
    const client = await useRealComposer(startRun, {
      capabilities: { messageQueue: true },
      queueMessage,
      steerQueuedMessage,
      async *subscribeToRun({ threadId, runId }) {
        await activeRunFinished.promise;
        yield {
          id: "event-run-completed",
          type: "run.completed",
          threadId,
          runId,
          sequence: 1,
          occurredAt: at,
        };
      },
    });

    try {
      await client.sendMessage({
        threadId: chatMocks.threadId,
        text: "Current turn",
      });
      await mount(baseProps({ showModelSelector: false }));
      await act(async () =>
        chatMocks.composerProps.composerRef.current.setText("Steer this turn"),
      );
      const send = container.querySelector<HTMLButtonElement>(
        '[data-agent-composer-slot="send-button"]',
      )!;

      await act(async () => {
        send.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            metaKey: true,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(queueMessage).toHaveBeenCalledOnce();
      expect(steerQueuedMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: chatMocks.threadId,
          messageId: "queued-steer",
          interruptActiveRun: true,
        }),
        expect.anything(),
      );
      expect(startRun).toHaveBeenCalledOnce();
      expect(client.getThread(chatMocks.threadId).queuedMessages).toEqual([]);
    } finally {
      activeRunFinished.resolve();
      await flush();
    }
  });

  it("keeps the real editor editable while a submission is in flight", async () => {
    chatMocks.useRealChat = true;
    chatMocks.history = { isSubmissionInFlight: true };
    await useRealComposer();
    await mount(baseProps({ showModelSelector: false }));

    const editor = container.querySelector<HTMLElement>(
      '[contenteditable="true"]',
    );
    expect(editor).not.toBeNull();
    expect(chatMocks.composerProps.submissionDisabled).toBe(true);

    await act(async () =>
      chatMocks.composerProps.composerRef.current.setText("Keep this draft"),
    );
    expect(editor?.textContent).toBe("Keep this draft");
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-agent-composer-slot="send-button"]',
      )?.disabled,
    ).toBe(true);
  });

  it.each(["default", "compact"] as const)(
    "clears the real %s composer before startRun resolves and preserves the next draft",
    async (composerLayoutVariant) => {
      const started = Promise.withResolvers<{ runId: string }>();
      const startRun = vi.fn(() => started.promise);
      chatMocks.useRealChat = true;
      const client = await useRealComposer(startRun);
      try {
        const props = baseProps({
          composerLayoutVariant,
          showModelSelector: false,
        });
        const openThread = vi.spyOn(client, "openThread");
        chatMocks.useRealRoot = true;
        await mount(props);
        container.style.width =
          composerLayoutVariant === "compact" ? "320px" : "960px";
        const composer = chatMocks.composerProps.composerRef.current;
        const editor = container.querySelector<HTMLElement>(
          '[contenteditable="true"]',
        )!;
        expect(editor).not.toBeNull();
        await act(async () => composer.setText("First prompt"));
        const send = container.querySelector<HTMLButtonElement>(
          '[data-agent-composer-slot="send-button"]',
        )!;
        expect(send.disabled).toBe(false);
        await act(async () => send.click());
        await flush();

        expect(startRun).toHaveBeenCalledOnce();
        expect(
          container.querySelector('.agentkit-message[data-role="user"]')
            ?.textContent,
        ).toContain("First prompt");
        expect(client.getThread(chatMocks.threadId).activeRunIds).toEqual([]);
        expect(editor.textContent).toBe("");

        await act(async () =>
          root.render(<AgentKitAssistantChat {...props} isNewThread={false} />),
        );
        await flush();

        expect(chatMocks.rootProps.load).toBe("manual");
        expect(openThread).not.toHaveBeenCalled();
        expect(
          container
            .querySelector<HTMLElement>("[contenteditable]")
            ?.getAttribute("contenteditable"),
        ).toBe("true");
        await act(async () => composer.setText("Next draft"));
        await act(async () => started.resolve({ runId: "run-latency" }));

        expect(editor.textContent).toBe("Next draft");
        expect(chatMocks.composerProps.initialText).toBe("Next draft");
        expect(startRun).toHaveBeenCalledOnce();
        expect(client.getThread(chatMocks.threadId).messages).toHaveLength(1);
      } finally {
        await act(async () => started.resolve({ runId: "run-latency" }));
      }
    },
  );

  it.each([undefined, "hidden"] as const)(
    "owns follow-up rendering with the real composer (placement: %s)",
    async (suggestionPlacement) => {
      const suggestion = seedFollowup();
      await useRealComposer();
      const props = baseProps({
        suggestionPlacement,
        showModelSelector: false,
      });
      chatMocks.omitSuggestionsSlot = true;
      await mount(props);
      const rows = () =>
        container.querySelectorAll(
          ".agentkit-host-suggestions, .agentkit-suggestions",
        );
      const chips = () =>
        [...container.querySelectorAll("button")].filter(
          (button) => button.textContent === suggestion.label,
        );
      const expected = suggestionPlacement === "hidden" ? 0 : 1;
      expect(rows()).toHaveLength(expected + 1);
      expect(chips()).toHaveLength(expected + 1);

      chatMocks.omitSuggestionsSlot = false;
      await act(async () => root.render(<AgentKitAssistantChat {...props} />));

      expect(rows()).toHaveLength(expected);
      expect(chips()).toHaveLength(expected);
      expect(container.querySelector(".agentkit-suggestions")).toBeNull();
      expect(
        chatMocks.realComposerController!.getThread(chatMocks.threadId)
          .suggestions,
      ).toEqual([suggestion]);
    },
  );

  it("disables host suggestions while async submission is pending", async () => {
    const suggestion = seedFollowup();
    await mount(baseProps());
    const chips = () =>
      [...container.querySelectorAll("button")].filter(
        (button) => button.textContent === suggestion.label,
      );
    expect(chips().length).toBeGreaterThan(0);
    expect(chips().some((button) => button.disabled)).toBe(false);

    await act(async () => {
      chatMocks.composerProps.onSubmissionPendingChange(true);
    });

    expect(chips().every((button) => button.disabled)).toBe(true);

    await act(async () => {
      chatMocks.composerProps.onSubmissionPendingChange(false);
    });
    expect(chips().every((button) => !button.disabled)).toBe(true);
  });

  it.each([undefined, "context-chips", "after-composer", "hidden"] as const)(
    "preserves initial starters with the real composer (placement: %s)",
    async (suggestionPlacement) => {
      chatMocks.renderEmptyState = true;
      await useRealComposer();
      await mount(
        baseProps({
          centerComposerWhenEmpty: true,
          suggestionPlacement,
          suggestions: ["Static starter"],
          showModelSelector: false,
        }),
      );
      const chips = [...container.querySelectorAll("button")].filter(
        (button) => button.textContent === "Static starter",
      );
      expect(chips).toHaveLength(suggestionPlacement === "hidden" ? 0 : 1);
      expect(container.querySelector(".agentkit-suggestions")).toBeNull();
    },
  );

  it.each([false, { getSuggestions: () => ["Heuristic fallback"] }])(
    "uses runtime follow-ups independently of initial dynamicSuggestions=%j",
    async (dynamicSuggestions) => {
      const suggestion = seedFollowup();
      await mount(
        baseProps({ suggestions: ["Static starter"], dynamicSuggestions }),
      );
      expect(chatMocks.suggestionBarProps.suggestions).toEqual([
        expect.objectContaining(suggestion),
      ]);
      expect(chatMocks.dynamicSuggestionOptions.enabled).toBe(false);
      expect(container.textContent).not.toContain("Static starter");
      expect(container.textContent).not.toContain("Heuristic fallback");
    },
  );

  it.each(["running", "awaiting_approval", "failed", "cancelled", "empty"])(
    "never falls back to static chips after a %s turn",
    async (status) => {
      seedFollowup();
      if (status === "empty") chatMocks.thread.suggestions = [];
      else chatMocks.thread.runs["run-1"].status = status;
      await mount(
        baseProps({
          suggestionPlacement: "context-chips",
          suggestions: ["Static starter"],
        }),
      );
      expect(
        container.querySelector('[data-testid="agentkit-suggestion-bar"]'),
      ).toBeNull();
      expect(chatMocks.dynamicSuggestionOptions.enabled).toBe(false);
    },
  );

  it("submits a chip's full prompt, local files, and fresh provider/integration context through the normal composer", async () => {
    const suggestion = seedFollowup();
    const items = [
      {
        key: "design-reference",
        title: "Reference",
        context: "Old design snapshot",
      },
      { key: "figma", title: "Figma", context: "Old invocation grant" },
    ];
    const prepared = [
      { ...items[0], context: "Fresh authorized design snapshot" },
      { ...items[1], context: "Fresh authorized Figma invocation" },
    ];
    const context: AssistantChatComposerContext = {
      menuItems: [],
      contextItems: items,
      onRemoveContextItem: vi.fn(),
      prepareSubmission: vi.fn(async () => prepared),
      submissionAccepted: vi.fn(),
    };
    const Provider = ({
      children,
    }: AssistantChatComposerContextProviderProps) => children(context);
    const file = new File(["image"], "reference.png", { type: "image/png" });
    chatMocks.control.uploadFiles.mockResolvedValueOnce([
      {
        type: "file",
        name: file.name,
        mediaType: file.type,
        url: "https://files.example.test/reference.png",
      },
    ]);
    chatMocks.pendingFiles = [file];
    chatMocks.pendingReferences = [{ type: "file", path: "/reference.md" }];
    await mount(baseProps({ composerContextProvider: Provider }));
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === suggestion.label,
    )!;
    await act(async () => button.click());
    await flush();
    expect(context.prepareSubmission).toHaveBeenCalledExactlyOnceWith(items);
    expect(chatMocks.control.uploadFiles).toHaveBeenCalledOnce();
    expect(chatMocks.control.sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        text: expect.stringContaining(suggestion.prompt),
        metadata: expect.objectContaining({
          suggestion: expect.objectContaining(suggestion),
          references: [{ type: "file", path: "/reference.md" }],
        }),
      }),
    );
    const sent = chatMocks.control.sendMessage.mock.calls[0][0] as any;
    expect(sent.text).toContain("Fresh authorized design snapshot");
    expect(sent.text).toContain("Fresh authorized Figma invocation");
    expect(sent.text).not.toContain("Old design snapshot");
    expect(context.submissionAccepted).toHaveBeenCalledExactlyOnceWith(
      prepared,
    );
    expect(chatMocks.pendingFiles).toEqual([]);
    expect(chatMocks.threadId).toBe("thread-1");
  });

  it.each(["permission", "send", "thread", "disabled"])(
    "preserves chip draft context after %s blocks submission",
    async (failure) => {
      const suggestion = seedFollowup();
      const items = [
        {
          key: "figma",
          title: "Figma",
          context: "Selected provider reference",
        },
      ];
      const pending = Promise.withResolvers<typeof items>();
      const context: AssistantChatComposerContext = {
        menuItems: [],
        contextItems: items,
        onRemoveContextItem: vi.fn(),
        prepareSubmission: vi.fn(() => pending.promise),
        submissionAccepted: vi.fn(),
      };
      const Provider = ({
        children,
      }: AssistantChatComposerContextProviderProps) => children(context);
      const props = baseProps({ composerContextProvider: Provider });
      const file = new File(["image"], "keep.png", { type: "image/png" });
      chatMocks.pendingFiles = [file];
      if (failure === "send")
        chatMocks.control.sendMessage.mockRejectedValueOnce(
          new Error("Send failed"),
        );
      await mount(props);
      await act(async () =>
        chatMocks.composerProps.onTextChange("Keep this draft"),
      );
      const button = [...container.querySelectorAll("button")].find(
        (item) => item.textContent === suggestion.label,
      )!;
      await act(async () => button.click());
      expect(context.prepareSubmission).toHaveBeenCalledOnce();
      if (failure === "thread") {
        chatMocks.threadId = "thread-2";
        await act(async () =>
          root.render(<AgentKitAssistantChat {...props} threadId="thread-2" />),
        );
      }
      if (failure === "disabled")
        await act(async () =>
          root.render(<AgentKitAssistantChat {...props} composerDisabled />),
        );
      await act(async () => {
        if (failure === "permission")
          pending.reject(new Error("Grant revoked"));
        else pending.resolve(items);
      });
      await flush();
      expect(context.submissionAccepted).not.toHaveBeenCalled();
      expect(chatMocks.pendingFiles).toEqual([file]);
      expect(context.contextItems).toEqual(items);
      if (failure !== "send")
        expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
      if (failure !== "thread")
        expect(chatMocks.composerProps.initialText).toBe("Keep this draft");
    },
  );

  it("retains selected context and local files when the chip's thread changes during upload", async () => {
    const suggestion = seedFollowup();
    const items = [
      { key: "figma", title: "Figma", context: "Authorized reference" },
    ];
    const context: AssistantChatComposerContext = {
      menuItems: [],
      contextItems: items,
      onRemoveContextItem: vi.fn(),
      prepareSubmission: vi.fn(async () => items),
      submissionAccepted: vi.fn(),
    };
    const Provider = ({
      children,
    }: AssistantChatComposerContextProviderProps) => children(context);
    const props = baseProps({ composerContextProvider: Provider });
    const file = new File(["image"], "keep.png", { type: "image/png" });
    chatMocks.pendingFiles = [file];
    const uploading = Promise.withResolvers<FilePart[]>();
    chatMocks.control.uploadFiles.mockReturnValueOnce(uploading.promise);
    await mount(props);
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent === suggestion.label)!
        .click(),
    );
    expect(context.prepareSubmission).toHaveBeenCalledOnce();
    expect(chatMocks.control.uploadFiles).toHaveBeenCalledOnce();
    chatMocks.threadId = "thread-2";
    await act(async () =>
      root.render(<AgentKitAssistantChat {...props} threadId="thread-2" />),
    );
    await act(async () =>
      uploading.resolve([
        {
          type: "file",
          name: "keep.png",
          mediaType: "image/png",
          url: "https://files.example.test/keep.png",
        },
      ]),
    );
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(context.submissionAccepted).not.toHaveBeenCalled();
    expect(chatMocks.pendingFiles).toEqual([file]);
  });

  it("locks the submission only while dispatching the message", async () => {
    const release = vi.fn();
    chatMocks.history = {
      isSubmissionInFlight: false,
      beginSubmission: vi.fn(async () => {
        chatMocks.history.isSubmissionInFlight = true;
        return release;
      }),
    };
    const props = baseProps();
    await mount(props);
    expect(chatMocks.history.beginSubmission).not.toHaveBeenCalled();
    await act(async () => root.render(<AgentKitAssistantChat {...props} />));
    expect(chatMocks.composerProps.disabled).toBe(false);
    expect(chatMocks.history.beginSubmission).not.toHaveBeenCalled();
    await act(async () =>
      chatMocks.composerProps.onSubmit("Send", [], [], { intent: "immediate" }),
    );
    expect(chatMocks.history.beginSubmission).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("revalidates captured app context separately from ambient context and acknowledges only accepted sends", async () => {
    const item = {
      key: "app-reference",
      title: "Reference",
      context: "Captured source",
    };
    const prepared = [{ ...item, context: "Fresh source" }];
    const context: AssistantChatComposerContext = {
      menuItems: [{ id: "reference", label: "Reference", onSelect: vi.fn() }],
      contextItems: [item],
      onRemoveContextItem: vi.fn(),
      onRetryContextItem: vi.fn(),
      onInspectContextItem: vi.fn(),
      dialogs: <div data-app-dialog="true" />,
      prepareSubmission: vi.fn(async () => prepared),
      submissionAccepted: vi.fn(),
    };
    const Provider = ({
      children,
    }: AssistantChatComposerContextProviderProps) => children(context);
    const ref = createRef<AssistantChatHandle>();
    const props = baseProps({
      composerContextProvider: Provider,
      plusMenuMode: "full",
    });
    await mount(props, ref);
    const ambient = {
      key: "ambient",
      title: "Selection",
      context: "Core selection",
    };
    await act(async () => ref.current!.setComposerContextItem(ambient));
    expect(chatMocks.composerProps.contextItems).toEqual([ambient, item]);
    expect(chatMocks.composerProps.contextMenuItems).toBe(context.menuItems);
    expect(chatMocks.composerProps.onInspectContextItem).toBeUndefined();
    expect(chatMocks.composerProps.plusMenuMode).toBe("full");
    expect(container.querySelector("[data-app-dialog]")).not.toBeNull();
    await act(async () => chatMocks.composerProps.onRetryContextItem(item.key));
    expect(context.onRetryContextItem).toHaveBeenCalledWith(item.key);
    expect(context.onInspectContextItem).not.toHaveBeenCalled();
    const accepted = Promise.withResolvers<void>();
    chatMocks.control.sendMessage.mockImplementationOnce(
      () => accepted.promise,
    );
    let submit!: Promise<void>;
    await act(async () => {
      submit = chatMocks.composerProps.onSubmit("Use the source", [], [], {
        intent: "immediate",
        contextItems: chatMocks.composerProps.contextItems,
      });
      await Promise.resolve();
    });
    expect(context.prepareSubmission).toHaveBeenCalledWith([item]);
    expect(context.submissionAccepted).not.toHaveBeenCalled();
    const laterItem = {
      key: "later-reference",
      title: "Later",
      context: "Not submitted",
    };
    context.contextItems = [item, laterItem];
    await act(async () =>
      root.render(<AgentKitAssistantChat {...props} ref={ref} />),
    );
    await act(async () => {
      accepted.resolve();
      await submit;
    });
    expect(chatMocks.control.sendMessage.mock.calls[0]?.[0].text).toContain(
      "Core selection",
    );
    expect(chatMocks.control.sendMessage.mock.calls[0]?.[0].text).toContain(
      "Fresh source",
    );
    expect(chatMocks.control.sendMessage.mock.calls[0]?.[0].text).not.toContain(
      "Captured source",
    );
    expect(chatMocks.control.sendMessage.mock.calls[0]?.[0].text).not.toContain(
      "Not submitted",
    );
    expect(context.submissionAccepted).toHaveBeenCalledExactlyOnceWith(
      prepared,
    );
    expect(vi.mocked(context.submissionAccepted).mock.calls[0]?.[0]).toBe(
      prepared,
    );
    expect(chatMocks.composerProps.contextItems).toContain(laterItem);
    await act(async () =>
      chatMocks.composerProps.onRemoveContextItem(item.key),
    );
    expect(context.onRemoveContextItem).toHaveBeenCalledWith(item.key);
  });

  it("keeps staged prefill context in its target thread", async () => {
    const ref = createRef<AssistantChatHandle>();
    const props = baseProps();
    await mount(props, ref);

    await act(async () =>
      ref.current!.setComposerContextItem(
        {
          key: "agent-chat-prefill-context",
          title: "Active app context",
          context: "Selected rows: a, b",
        },
        { focus: false, threadScoped: true },
      ),
    );

    const staged = {
      key: "agent-chat-prefill-context:thread-1",
      title: "Active app context",
      context: "Selected rows: a, b",
      targetThreadId: "thread-1",
      stagedAt: expect.any(Number),
    };
    expect(
      (
        chatMocks.appState.get("agent-chat-context") as {
          items: unknown[];
        }
      ).items,
    ).toEqual([staged]);
    expect(chatMocks.contextItems).toEqual([staged]);
    expect(chatMocks.composerProps.contextItems).toEqual([staged]);

    await act(async () =>
      ref.current!.removeComposerContextItem("agent-chat-prefill-context", {
        threadScoped: true,
      }),
    );
    expect(
      (
        chatMocks.appState.get("agent-chat-context") as {
          items: unknown[];
        }
      ).items,
    ).toEqual([]);
    expect(chatMocks.composerProps.contextItems).toEqual([]);

    chatMocks.threadId = "thread-2";
    await act(async () =>
      root.render(
        <AgentKitAssistantChat {...baseProps({ threadId: "thread-2" })} />,
      ),
    );
    expect(chatMocks.composerProps.contextItems).toEqual([]);
  });

  it.each(["schedule", "automation", "skill"])(
    "preserves internal %s mode instructions while refreshing only provider context",
    async (mode) => {
      const item = {
        key: "app-reference",
        title: "Reference",
        context: "Stale source",
      };
      const prepared = [{ ...item, context: "Fresh source" }];
      const composerModeContext = `Internal ${mode} instructions`;
      const context: AssistantChatComposerContext = {
        menuItems: [],
        contextItems: [item],
        onRemoveContextItem: vi.fn(),
        prepareSubmission: vi.fn(async () => prepared),
        submissionAccepted: vi.fn(),
      };
      const Provider = ({
        children,
      }: AssistantChatComposerContextProviderProps) => children(context);
      await mount(baseProps({ composerContextProvider: Provider }));
      await act(async () => {
        await chatMocks.composerProps.onSubmit(`Create ${mode}`, [], [], {
          intent: "immediate",
          contextItems: [item],
          composerModeContext,
        });
      });
      expect(context.prepareSubmission).toHaveBeenCalledExactlyOnceWith([item]);
      const message = chatMocks.control.sendMessage.mock.calls[0]?.[0]?.text;
      expect(message).toContain(`Create ${mode}`);
      expect(message).toContain(composerModeContext);
      expect(message?.split(composerModeContext)).toHaveLength(2);
      expect(message).toContain("Fresh source");
      expect(message).not.toContain("Stale source");
      expect(context.submissionAccepted).toHaveBeenCalledExactlyOnceWith(
        prepared,
      );
    },
  );

  it.each(["prepare", "dispatch"])(
    "preserves provider context when %s rejects",
    async (failure) => {
      const release = vi.fn();
      chatMocks.history = { beginSubmission: vi.fn(async () => release) };
      const items = [
        { key: "app-reference", title: "Reference", context: "Source" },
      ];
      const context: AssistantChatComposerContext = {
        menuItems: [],
        contextItems: items,
        onRemoveContextItem: vi.fn(),
        prepareSubmission: vi.fn(async () => items),
        submissionAccepted: vi.fn(),
      };
      if (failure === "prepare")
        vi.mocked(context.prepareSubmission).mockRejectedValueOnce(
          new Error("Source unavailable"),
        );
      else
        chatMocks.control.sendMessage.mockRejectedValueOnce(
          new Error("Source unavailable"),
        );
      const Provider = ({
        children,
      }: AssistantChatComposerContextProviderProps) => children(context);
      await mount(baseProps({ composerContextProvider: Provider }));
      await act(async () => {
        chatMocks.composerProps.onTextChange("Use source");
      });
      await act(async () => {
        await expect(
          chatMocks.composerProps.onSubmit("Use source", [], [], {
            intent: "immediate",
            contextItems: items,
            composerModeContext: "Internal scheduling instructions",
          }),
        ).rejects.toThrow("Source unavailable");
      });
      expect(release).toHaveBeenCalledExactlyOnceWith();
      expect(context.submissionAccepted).not.toHaveBeenCalled();
      expect(chatMocks.composerProps.contextItems).toEqual(items);
      expect(chatMocks.composerProps.initialText).toBe("Use source");
      if (failure === "prepare")
        expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    },
  );

  it("does not acknowledge provider context when the submission lock refuses a send", async () => {
    chatMocks.history = { beginSubmission: vi.fn(async () => null) };
    const items = [
      { key: "app-reference", title: "Reference", context: "Source" },
    ];
    const context: AssistantChatComposerContext = {
      menuItems: [],
      contextItems: items,
      onRemoveContextItem: vi.fn(),
      prepareSubmission: vi.fn(async () => items),
      submissionAccepted: vi.fn(),
    };
    const Provider = ({
      children,
    }: AssistantChatComposerContextProviderProps) => children(context);
    await mount(baseProps({ composerContextProvider: Provider }));
    await act(async () => {
      await expect(
        chatMocks.composerProps.onSubmit("Use source", [], [], {
          intent: "immediate",
          composerModeContext: "Internal scheduling instructions",
        }),
      ).rejects.toThrow();
    });
    expect(context.submissionAccepted).not.toHaveBeenCalled();
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it.each(["dropped", "additional", "duplicate"])(
    "rejects %s prepared context with a typed error",
    async (kind) => {
      const item = {
        key: "app-reference",
        title: "Reference",
        context: "Source",
      };
      const prepared =
        kind === "dropped"
          ? []
          : kind === "duplicate"
            ? [item, item]
            : [item, { ...item, key: "other" }];
      const context: AssistantChatComposerContext = {
        menuItems: [],
        contextItems: [item],
        onRemoveContextItem: vi.fn(),
        prepareSubmission: vi.fn(async () => prepared),
        submissionAccepted: vi.fn(),
      };
      const Provider = ({
        children,
      }: AssistantChatComposerContextProviderProps) => children(context);
      await mount(baseProps({ composerContextProvider: Provider }));
      await act(async () => {
        await expect(
          chatMocks.composerProps.onSubmit("Use source", [], [], {
            intent: "immediate",
          }),
        ).rejects.toMatchObject({ code: "composer_context_mismatch" });
      });
      expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
      expect(context.submissionAccepted).not.toHaveBeenCalled();
    },
  );

  it.each([
    "disabled",
    "inactive",
    "readiness",
    "account",
    "identity",
    "thread",
    "scope",
  ])("rejects stale provider preparation after a %s change", async (change) => {
    const release = vi.fn();
    chatMocks.history = { beginSubmission: vi.fn(async () => release) };
    const items = [
      { key: "app-reference", title: "Reference", context: "Source" },
    ];
    const prepared = Promise.withResolvers<typeof items>();
    const context: AssistantChatComposerContext = {
      menuItems: [],
      contextItems: items,
      onRemoveContextItem: vi.fn(),
      prepareSubmission: vi.fn(() => prepared.promise),
      submissionAccepted: vi.fn(),
    };
    const mounts = vi.fn();
    const providerProps = vi.fn();
    function Provider(props: AssistantChatComposerContextProviderProps) {
      React.useEffect(() => {
        mounts();
      }, []);
      providerProps(props);
      return props.children(context);
    }
    const props = baseProps({
      composerContextProvider: Provider,
    });
    await mount(props);
    let rejected!: Promise<unknown>;
    await act(async () => {
      chatMocks.composerProps.onTextChange("Use source");
    });
    await act(async () => {
      rejected = expect(
        chatMocks.composerProps.onSubmit("Use source", [], [], {
          intent: "immediate",
          composerModeContext: "Internal scheduling instructions",
        }),
      ).rejects.toThrow();
    });
    const next = { ...props };
    if (change === "disabled") next.composerDisabled = true;
    if (change === "inactive") next.isActiveComposer = false;
    if (change === "readiness")
      chatMocks.readiness = { canChat: false, missing: true, state: "missing" };
    if (change === "account")
      chatMocks.session = {
        authUserId: "user-2",
        email: "second@example.test",
        orgId: "workspace-2",
      };
    if (change === "identity")
      chatMocks.session = { ...chatMocks.session, authUserId: "user-2" };
    if (change === "thread") {
      next.threadId = "thread-2";
      chatMocks.threadId = "thread-2";
    }
    if (change === "scope") next.contextScope = { type: "deck", id: "deck-2" };
    await act(async () => root.render(<AgentKitAssistantChat {...next} />));
    await act(async () => {
      prepared.resolve(items);
      await rejected;
    });
    expect(release).toHaveBeenCalledExactlyOnceWith();
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(context.submissionAccepted).not.toHaveBeenCalled();
    if (
      change === "disabled" ||
      change === "inactive" ||
      change === "readiness"
    ) {
      expect(chatMocks.composerProps.initialText).toBe("Use source");
      expect(chatMocks.composerProps.contextItems).toEqual(items);
    }
    if (change === "account" || change === "identity" || change === "thread")
      expect(mounts).toHaveBeenCalledTimes(2);
    if (change === "inactive")
      expect(providerProps.mock.lastCall?.[0].isActive).toBe(false);
  });

  it("keeps a prepared send when only the resource selection revision changes", async () => {
    const items = [
      { key: "app-reference", title: "Reference", context: "Source" },
    ];
    const prepared = Promise.withResolvers<typeof items>();
    const context: AssistantChatComposerContext = {
      menuItems: [],
      contextItems: items,
      onRemoveContextItem: vi.fn(),
      prepareSubmission: vi.fn(() => prepared.promise),
      submissionAccepted: vi.fn(),
    };
    const Provider = ({
      children,
    }: AssistantChatComposerContextProviderProps) => children(context);
    const props = baseProps({
      contextScope: {
        type: "deck",
        id: "deck-1",
        label: "Deck",
      },
      composerContextProvider: Provider,
    });
    const revisedScope = {
      type: "deck",
      id: "deck-1",
      label: "Deck",
      contextVersion: "selection-revision-2",
    };
    await mount(props);
    let submitted!: Promise<void>;
    await act(async () => {
      submitted = chatMocks.composerProps.onSubmit("Use source", [], [], {
        intent: "immediate",
      });
    });
    await act(async () => {
      root.render(
        <AgentKitAssistantChat {...props} contextScope={revisedScope} />,
      );
    });
    await act(async () => {
      prepared.resolve(items);
      await submitted;
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(context.submissionAccepted).toHaveBeenCalledOnce();
  });

  it("continues a pending send when readiness becomes configured during preparation", async () => {
    chatMocks.readiness = {
      canChat: false,
      missing: false,
      state: "unknown",
    };
    const items = [
      { key: "app-reference", title: "Reference", context: "Source" },
    ];
    const prepared = Promise.withResolvers<typeof items>();
    const context: AssistantChatComposerContext = {
      menuItems: [],
      contextItems: items,
      onRemoveContextItem: vi.fn(),
      prepareSubmission: vi.fn(() => prepared.promise),
      submissionAccepted: vi.fn(),
    };
    const Provider = ({
      children,
    }: AssistantChatComposerContextProviderProps) => children(context);
    await mount(baseProps({ composerContextProvider: Provider }));

    let submission!: Promise<void>;
    await act(async () => {
      submission = chatMocks.composerProps.onSubmit("Use source", [], [], {
        intent: "immediate",
        composerModeContext: "Internal scheduling instructions",
      });
      await Promise.resolve();
    });
    expect(context.prepareSubmission).toHaveBeenCalledOnce();

    chatMocks.readiness = {
      canChat: true,
      missing: false,
      state: "configured",
    };
    await act(async () =>
      root.render(
        <AgentKitAssistantChat
          {...baseProps({ composerContextProvider: Provider })}
        />,
      ),
    );
    await act(async () => {
      prepared.resolve(items);
      await submission;
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(context.submissionAccepted).toHaveBeenCalledExactlyOnceWith(items);
  });

  it("loads the model catalog only when the visible picker has no host catalog", async () => {
    await mount(baseProps());
    expect(chatMocks.composerProps.modelStatusChecksEnabled).toBe(true);

    await unmount();
    await mount(baseProps({ availableModels: [], modelListLoading: true }));
    expect(chatMocks.composerProps.modelStatusChecksEnabled).toBe(false);

    await unmount();
    await mount(baseProps({ showModelSelector: false }));
    expect(chatMocks.composerProps.modelStatusChecksEnabled).toBe(false);
  });

  it("shows missing-provider setup when the model catalog is unavailable", async () => {
    const onRetryModelList = vi.fn();
    chatMocks.readiness = {
      canChat: false,
      missing: true,
      state: "missing",
    };
    await mount(
      baseProps({
        modelListError: true,
        onRetryModelList,
      }),
    );

    expect(chatMocks.setupCardProps).toMatchObject({ attached: true });
    expect(chatMocks.providerGateProps).toBeNull();
    expect(container.textContent).not.toContain(
      "agentChat.setup.modelListUnavailable",
    );

    expect(onRetryModelList).not.toHaveBeenCalled();
  });

  it("offers a model catalog retry when AI is configured", async () => {
    const onRetryModelList = vi.fn();
    chatMocks.readiness = {
      canChat: true,
      missing: false,
      state: "configured",
    };
    await mount(
      baseProps({
        modelListError: true,
        onRetryModelList,
      }),
    );

    expect(chatMocks.setupCardProps).toBeNull();
    expect(chatMocks.providerGateProps).toMatchObject({
      modelListUnavailable: true,
      providerStatus: "unavailable",
    });
    expect(container.textContent).toContain(
      "agentChat.setup.modelListUnavailable",
    );

    const dispatchEvent = vi.spyOn(window, "dispatchEvent");
    await act(async () => container.querySelector("button")?.click());
    expect(onRetryModelList).toHaveBeenCalledOnce();
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-engine:configured-changed" }),
    );
    dispatchEvent.mockRestore();
  });

  it("leaves an unknown provider editable without a checking-state banner", async () => {
    chatMocks.readiness = {
      canChat: false,
      missing: false,
      state: "unknown",
    };
    await mount(baseProps());

    expect(chatMocks.composerProps.disabled).toBe(false);
    expect(chatMocks.composerProps.submissionDisabled).toBe(false);
    expect(
      container.querySelector('[data-testid="provider-preflight-pending"]'),
    ).toBeNull();
    expect(chatMocks.composerProps.onBeforeSubmit).toBeUndefined();
  });

  it("disables the composer and attaches one setup card after confirmed missing status", async () => {
    chatMocks.readiness = { canChat: false, missing: true, state: "missing" };
    await mount(baseProps());

    expect(chatMocks.composerProps.disabled).toBe(true);
    expect(chatMocks.composerProps.submissionDisabled).toBe(true);
    expect(chatMocks.setupCardProps).toMatchObject({ attached: true });
    expect(
      container.querySelectorAll('[data-testid="builder-setup-card"]'),
    ).toHaveLength(1);
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps the composer editable when the host blocks submission", async () => {
    await mount(
      baseProps({
        composerSubmissionDisabled: true,
      }),
    );

    expect(chatMocks.composerProps.disabled).toBe(false);
    expect(chatMocks.composerProps.submissionDisabled).toBe(true);
    expect(chatMocks.composerProps.onBeforeSubmit).toBeUndefined();
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      centerComposerWhenEmpty: false,
      suggestionPlacement: "context-chips" as const,
    },
    {
      centerComposerWhenEmpty: true,
      suggestionPlacement: "context-chips" as const,
    },
    {
      centerComposerWhenEmpty: true,
      suggestionPlacement: "after-composer" as const,
    },
  ])(
    "hides suggestions without AI for $suggestionPlacement (centered=$centerComposerWhenEmpty)",
    async (placement) => {
      const props = baseProps({
        ...placement,
        suggestions: ["Explore my apps"],
      });
      await mount(props);
      for (const state of [
        "configured",
        "missing",
        "unknown",
        "unavailable",
        "configured",
      ]) {
        const ready = state === "configured";
        chatMocks.readiness = {
          canChat: ready,
          missing: state === "missing",
          state,
        };
        await act(async () =>
          root.render(<AgentKitAssistantChat {...props} />),
        );
        expect(
          Boolean(
            container.querySelector('[data-testid="agentkit-suggestion-bar"]'),
          ),
        ).toBe(ready);
        expect(chatMocks.dynamicSuggestionOptions.enabled).toBe(ready);
        expect(chatMocks.composerProps.disabled).toBe(
          !ready && state !== "unknown" && state !== "unavailable",
        );
      }
      expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    },
  );

  it("places starter prompts between the composer and after-composer content", async () => {
    chatMocks.renderEmptyState = true;
    await mount(
      baseProps({
        centerComposerWhenEmpty: true,
        suggestionPlacement: "after-composer",
        emptyStateDisplay: "default",
        homeIntroSlot: <h1>What should we do?</h1>,
        afterComposerSlot: <div data-testid="home-app-grid" />,
        suggestions: ["Explore my apps"],
      }),
    );

    const composer = container.querySelector(".agentkit-host-composer");
    expect(
      composer?.querySelector(".agentkit-home-intro h1")?.textContent,
    ).toBe("What should we do?");
    expect(chatMocks.dynamicSuggestionOptions.staticSuggestions).toEqual([
      "Explore my apps",
    ]);
    expect(chatMocks.suggestionBarProps.className).toBe(
      "agentkit-home-suggestions",
    );
    expect(chatMocks.chatProps.emptyComposerPlacement).toBe("center");
    const composerElement = container.querySelector(
      '[data-testid="agentkit-composer"]',
    );
    const suggestionElement = container.querySelector(
      ".agentkit-home-suggestions",
    );
    const afterComposerElement = container.querySelector(
      ".agentkit-after-composer-slot",
    );
    expect(composerElement).not.toBeNull();
    expect(suggestionElement).not.toBeNull();
    expect(afterComposerElement).not.toBeNull();
    expect(
      composerElement!.compareDocumentPosition(suggestionElement!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      suggestionElement!.compareDocumentPosition(afterComposerElement!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      container.querySelectorAll('[data-testid="agentkit-suggestion-bar"]'),
    ).toHaveLength(1);
    expect(
      container
        .querySelector("button")
        ?.closest('[data-testid="agentkit-suggestion-bar"]'),
    ).toBe(suggestionElement);
    expect(container.querySelector(".agentkit-host-suggestions")).toBeNull();
    expect(
      composer?.querySelector(".agentkit-after-composer-slot"),
    ).not.toBeNull();
  });

  it("keeps transient voice messages scoped to the active thread", async () => {
    const base = baseProps({
      centerComposerWhenEmpty: true,
      suggestionPlacement: "context-chips",
      homeIntroSlot: <h1>What should we do?</h1>,
      suggestions: ["Explore my apps"],
    });
    await mount(base);

    const firstThreadRegistration = chatMocks.voiceTranscriptRegistration;
    await act(async () => {
      expect(
        firstThreadRegistration.append({
          id: "voice-message-1",
          threadId: "thread-1",
          role: "user",
          text: "Summarize this call",
          createdAt: "2026-09-27T12:00:00.000Z",
        }),
      ).toBe(true);
    });
    expect(chatMocks.chatProps.hasRenderedMessages).toBe(true);

    chatMocks.threadId = "thread-2";
    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          {...baseProps({
            ...base,
            threadId: "thread-2",
          })}
        />,
      );
    });

    expect(chatMocks.chatProps.hasRenderedMessages).toBe(false);
    expect(chatMocks.chatProps.emptyComposerPlacement).toBe("center");
    expect(container.querySelector(".agentkit-home-intro")).not.toBeNull();
    expect(
      firstThreadRegistration.append({
        id: "voice-message-2",
        threadId: "thread-1",
        role: "user",
        text: "Ignore the stale sink",
        createdAt: "2026-09-27T12:01:00.000Z",
      }),
    ).toBe(false);
  });

  it("uses custom conversation content in the empty-state layout", async () => {
    await mount(
      baseProps({
        centerComposerWhenEmpty: true,
        homeIntroSlot: <h1>What should we do?</h1>,
        threadContentSlot: <div>Existing conversation content</div>,
      }),
    );

    expect(chatMocks.chatProps.hasRenderedMessages).toBe(true);
    expect(container.textContent).toContain("Existing conversation content");
    expect(container.querySelector(".agentkit-home-intro")).toBeNull();
  });

  it("puts the beginning revert before messages inside the scrollable transcript", async () => {
    chatMocks.thread.messages = [
      { id: "first-message", role: "user", parts: [] },
    ];
    await mount(baseProps());

    const revert = container.querySelector(
      '[data-testid="history-beginning-revert"]',
    );
    const firstMessage = container.querySelector(
      '[data-testid="first-transcript-message"]',
    );
    expect(chatMocks.chatProps.toolbar).toBeUndefined();
    expect(revert?.closest(".agentkit-transcript-content")).not.toBeNull();
    expect(
      revert!.compareDocumentPosition(firstMessage!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("provides the host-pinned thinking display to the direct AgentKit surface", async () => {
    await mount(baseProps({ thinkingDisplay: "hidden" }));

    expect(chatMocks.thinkingDisplay).toBe("hidden");
  });

  it("keeps its transport stable while runtime selector refs update", async () => {
    const initialScope = { type: "document", id: "doc-1" };
    await mount(
      baseProps({
        selectedModel: "model-1",
        selectedEngine: "engine-1",
        selectedEffort: "low",
        execMode: "build",
        contextScope: initialScope,
        streamingUrl: "https://stream.example.test/agent-chat",
      }),
    );
    const transport = chatMocks.rootProps.transport;
    const runtimeOptions = chatMocks.runtimeOptions;

    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          {...baseProps({
            selectedModel: "model-2",
            selectedEngine: "engine-2",
            selectedEffort: "high",
            execMode: "plan",
            contextScope: { type: "document", id: "doc-2" },
            streamingUrl: "https://stream.example.test/agent-chat",
          })}
        />,
      );
    });

    expect(chatMocks.rootProps.transport).toBe(transport);
    expect(chatMocks.createRuntime).toHaveBeenCalledOnce();
    expect(runtimeOptions.model).toBe("model-2");
    expect(runtimeOptions.engine).toBe("engine-2");
    expect(runtimeOptions.effort).toBe("high");
    expect(runtimeOptions.mode).toBe("plan");
    expect(runtimeOptions.scope).toEqual({ type: "document", id: "doc-2" });
    expect(runtimeOptions.streamingUrl).toBe(
      "https://stream.example.test/agent-chat",
    );
  });

  it("keeps the managed AgentKit transport alive across restore retries and thread changes", async () => {
    await mount(baseProps({ isNewThread: false }));
    const transport = chatMocks.rootProps.transport;
    expect(chatMocks.transportOptions.threadId).toBe("thread-1");
    expect(chatMocks.runtimeOptions.threadId).toBe("thread-1");
    expect(chatMocks.rootProps.clientOptions).toMatchObject({
      retainActiveRunsOnThreadRelease: true,
    });

    await act(async () => {
      chatMocks.rootProps.onLoadError(
        Object.assign(new Error("offline"), { status: 503 }),
      );
    });
    const retryButton = container.querySelector("button");
    expect(retryButton).not.toBeNull();
    vi.useFakeTimers();
    try {
      await act(async () => retryButton!.click());
      expect(chatMocks.rootProps.load).toBe("manual");
      await act(async () => vi.runOnlyPendingTimersAsync());
      expect(chatMocks.rootProps.load).toBe("auto");
    } finally {
      vi.useRealTimers();
    }
    expect(chatMocks.rootProps.transport).toBe(transport);

    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          {...baseProps({ isNewThread: false, threadId: "thread-2" })}
        />,
      );
    });
    expect(chatMocks.rootProps.transport).toBe(transport);
    expect(chatMocks.transportOptions.threadId).toBe("thread-2");
    expect(chatMocks.runtimeOptions.threadId).toBe("thread-2");
  });

  it("keeps the composer text callback stable across host rerenders", async () => {
    await mount(baseProps({ selectedModel: "model-1" }));
    const onTextChange = chatMocks.composerProps.onTextChange;

    await act(async () => {
      root.render(
        <AgentKitAssistantChat {...baseProps({ selectedModel: "model-2" })} />,
      );
    });

    expect(chatMocks.composerProps.onTextChange).toBe(onTextChange);
  });

  it("blocks attachments until file storage is configured", async () => {
    chatMocks.fileUploadStatus = {
      data: { configured: false },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };

    await mount(baseProps());

    expect(chatMocks.fileStoragePopoverProps).toMatchObject({
      open: false,
      status: "missing",
    });
    expect(chatMocks.composerProps.attachmentsEnabled).toBe(false);
    expect(chatMocks.composerProps.onAttachmentRequest).toEqual(
      expect.any(Function),
    );
    expect(chatMocks.chatProps.composerProps.attachmentsEnabled).toBe(false);

    await act(async () => chatMocks.composerProps.onAttachmentRequest());
    expect(chatMocks.fileStoragePopoverProps.open).toBe(true);
    expect(
      chatMocks.fileStoragePopoverProps.anchorRef.current.classList.contains(
        "agentkit-host-composer",
      ),
    ).toBe(true);

    chatMocks.fileUploadStatus = {
      data: { configured: true },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };
    chatMocks.fileStoragePopoverProps = null;
    await act(async () => {
      root.render(<AgentKitAssistantChat {...baseProps()} />);
    });

    expect(chatMocks.fileStoragePopoverProps.open).toBe(false);
    expect(chatMocks.composerProps.attachmentsEnabled).toBe(true);
    expect(chatMocks.chatProps.composerProps.attachmentsEnabled).toBe(true);
  });

  it("does not show a storage setup prompt while its status is loading", async () => {
    chatMocks.fileUploadStatus = {
      data: undefined,
      isError: false,
      isLoading: true,
      refetch: vi.fn(),
    };

    await mount(baseProps());

    expect(chatMocks.fileStoragePopoverProps).toMatchObject({
      open: false,
      status: "unavailable",
    });
    expect(chatMocks.composerProps.attachmentsEnabled).toBe(false);
  });

  it("keeps upload-status retry inside the explicit storage dialog", async () => {
    const refetch = vi.fn();
    chatMocks.fileUploadStatus = {
      data: undefined,
      isError: true,
      isLoading: false,
      refetch,
    };

    await mount(baseProps());

    expect(chatMocks.fileStoragePopoverProps).toMatchObject({
      open: false,
      status: "unavailable",
      onRetry: expect.any(Function),
    });
    await act(async () => chatMocks.composerProps.onAttachmentRequest());
    expect(chatMocks.fileStoragePopoverProps.open).toBe(true);
    await act(async () => chatMocks.fileStoragePopoverProps.onRetry());
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("rejects imperative uploads while file storage is unavailable", async () => {
    chatMocks.fileUploadStatus = {
      data: { configured: false },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };
    const ref = createRef<AssistantChatHandle>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<AgentKitAssistantChat ref={ref} {...baseProps()} />);
    });

    await expect(
      ref.current?.sendMessage("Analyze this file", undefined, {
        attachments: [
          { type: "text/plain", name: "notes.txt", text: "private notes" },
        ],
      }),
    ).rejects.toThrow("onboarding.fileStorage.title");

    expect(chatMocks.control.uploadFiles).not.toHaveBeenCalled();
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("uploads data URL image parts to durable URLs before sending", async () => {
    const ref = createRef<AssistantChatHandle>();
    await mount(baseProps(), ref);
    const imageUrl = "data:image/png;base64,aGVsbG8=";
    chatMocks.control.uploadFiles.mockResolvedValueOnce([
      {
        type: "file",
        name: "image",
        mediaType: "image/png",
        url: "https://files.example.test/image.png",
      },
    ]);

    await act(async () => {
      await ref.current?.sendMessage("Use this image", [imageUrl]);
    });

    expect(chatMocks.control.uploadFiles).toHaveBeenCalledOnce();
    expect(chatMocks.control.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Use this image",
        attachments: [
          {
            type: "file",
            name: "image",
            mediaType: "image/png",
            url: "https://files.example.test/image.png",
          },
        ],
      }),
    );
  });

  it("uploads composer files once and keeps pasted text in the prompt", async () => {
    await mount(baseProps());
    const image = new File(["image bytes"], "slide-image.png", {
      type: "image/png",
    });
    chatMocks.control.uploadFiles.mockResolvedValueOnce([
      {
        type: "file",
        name: image.name,
        mediaType: image.type,
        url: "https://files.example.test/slide-image.png",
      },
    ]);

    await act(async () => {
      await chatMocks.composerProps.onSubmit(
        "Describe this slide",
        [image],
        [],
        {
          attachments: [
            { id: "image-1", type: "image", name: image.name, file: image },
          ],
        },
      );
    });

    expect(chatMocks.control.uploadFiles).toHaveBeenCalledOnce();
    expect(chatMocks.control.uploadFiles.mock.calls[0]?.[0]).toMatchObject([
      { name: image.name, mediaType: "image/png", size: image.size },
    ]);
    expect(chatMocks.control.sendMessage.mock.calls[0]?.[0]).toMatchObject({
      text: "Describe this slide",
      attachments: [
        {
          name: image.name,
          url: "https://files.example.test/slide-image.png",
        },
      ],
    });

    await act(async () => {
      await chatMocks.composerProps.onSubmit(
        "Summarize this pasted text:\n\nFull pasted document text",
        [],
        [],
        {
          attachments: [
            {
              id: "pasted-text-1",
              type: "file",
              name: "pasted-text-1.txt",
              file: new File(
                ["Full pasted document text"],
                "pasted-text-1.txt",
                {
                  type: "text/plain",
                },
              ),
            },
          ],
        },
      );
    });

    expect(chatMocks.control.uploadFiles).toHaveBeenCalledOnce();
    expect(chatMocks.control.sendMessage.mock.calls[1]?.[0]).toMatchObject({
      text: "Summarize this pasted text:\n\nFull pasted document text",
      attachments: [],
    });
  });

  it("validates a composer submission before uploading its files", async () => {
    const items = [
      { key: "figma", title: "Figma", context: "Authorized reference" },
    ];
    const prepare = Promise.withResolvers<typeof items>();
    const context: AssistantChatComposerContext = {
      menuItems: [],
      contextItems: items,
      onRemoveContextItem: vi.fn(),
      prepareSubmission: vi.fn(() => prepare.promise),
      submissionAccepted: vi.fn(),
    };
    const Provider = ({
      children,
    }: AssistantChatComposerContextProviderProps) => children(context);
    const firstScope = { type: "design", id: "first" };
    await mount(
      baseProps({
        contextScope: firstScope,
        composerContextProvider: Provider,
      }),
    );
    const file = new File(["image bytes"], "reference.png", {
      type: "image/png",
    });
    let submission!: Promise<void>;
    let rejection!: Promise<void>;

    await act(async () => {
      submission = chatMocks.composerProps.onSubmit(
        "Use this reference",
        [file],
        [],
        { intent: "immediate" },
      );
      await vi.waitFor(() =>
        expect(context.prepareSubmission).toHaveBeenCalledOnce(),
      );
    });
    rejection = expect(submission).rejects.toMatchObject({
      message: "agentChat.composer.submissionScopeChanged",
      code: "submission_scope_changed",
    });

    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          {...baseProps({
            contextScope: { type: "design", id: "second" },
            composerContextProvider: Provider,
          })}
        />,
      );
      prepare.resolve(items);
    });

    await rejection;
    expect(chatMocks.control.uploadFiles).not.toHaveBeenCalled();
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("stores only a durable URL for the resized image used by retry", async () => {
    const bitmap = {
      width: 2560,
      height: 1440,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      fillRect: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback, type) =>
        callback(new Blob(["resized pixels"], { type: type ?? "image/png" })),
    );
    const original = {
      type: "file" as const,
      name: "reference.png",
      mediaType: "image/png",
      url: "https://files.example.test/reference.png",
    };
    const resized = {
      type: "file" as const,
      name: "reference.png",
      mediaType: "image/png",
      url: "https://files.example.test/reference-resized.png",
    };
    chatMocks.control.uploadFiles
      .mockResolvedValueOnce([original])
      .mockResolvedValueOnce([resized]);
    await mount(baseProps());
    const file = new File([largePngBytes()], "reference.png", {
      type: "image/png",
    });

    await act(async () => {
      await chatMocks.composerProps.onSubmit("Use this reference", [file], [], {
        intent: "immediate",
      });
    });

    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(chatMocks.control.uploadFiles).toHaveBeenCalledTimes(2);
    const sent = chatMocks.control.sendMessage.mock.calls[0]?.[0] as any;
    expect(sent.requestAttachments).toMatchObject([
      {
        type: "image",
        name: "reference.png",
        contentType: "image/png",
        url: resized.url,
        referenceUrl: original.url,
      },
    ]);
    expect(sent.requestAttachments[0].data).toMatch(/^data:image\/png;base64,/);
    expect(sent.metadata.custom.agentNativeRetryRequestAttachments).toEqual([
      {
        type: "image",
        name: "reference.png",
        contentType: "image/png",
        url: resized.url,
        referenceUrl: original.url,
      },
    ]);
    expect(JSON.stringify(sent.metadata.custom)).not.toContain("data:image");
  });

  it("sends multiple resized images by durable URL without exceeding the inline payload cap", async () => {
    const bitmap = {
      width: 2560,
      height: 1440,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      fillRect: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback, type) =>
        callback(
          new Blob([new Uint8Array(2 * 1024 * 1024)], {
            type: type ?? "image/png",
          }),
        ),
    );
    const names = ["reference-1.png", "reference-2.png", "reference-3.png"];
    const originals = names.map((name, index) => ({
      type: "file" as const,
      name,
      mediaType: "image/png",
      url: `https://files.example.test/original-${index}.png`,
    }));
    const resized = names.map((name, index) => ({
      type: "file" as const,
      name,
      mediaType: "image/png",
      url: `https://files.example.test/resized-${index}.png`,
    }));
    for (const original of originals) {
      chatMocks.control.uploadFiles.mockResolvedValueOnce([original]);
    }
    chatMocks.control.uploadFiles.mockResolvedValueOnce(resized);
    await mount(baseProps());
    const files = names.map(
      (name) =>
        new File([largePngBytes()], name, {
          type: "image/png",
        }),
    );

    await act(async () => {
      await chatMocks.composerProps.onSubmit(
        "Use these references",
        files,
        [],
        { intent: "immediate" },
      );
    });

    const perImageDataUrlChars =
      4 * Math.ceil((2 * 1024 * 1024) / 3) + "data:image/png;base64,".length;
    expect(perImageDataUrlChars * files.length).toBeGreaterThan(6_000_000);
    const sent = chatMocks.control.sendMessage.mock.calls[0]?.[0] as any;
    expect(sent.requestAttachments).toEqual(
      resized.map((attachment, index) => ({
        type: "image",
        name: attachment.name,
        contentType: "image/png",
        url: attachment.url,
        referenceUrl: originals[index]!.url,
      })),
    );
    expect(
      sent.requestAttachments.every((attachment: any) => !attachment.data),
    ).toBe(true);
  });

  it.each(["immediate", "queued"] as const)(
    "sends resized vision bytes with a durable retry payload for %s when the original reference upload fails",
    async (intent) => {
      const bitmap = {
        width: 2560,
        height: 1440,
        close: vi.fn(),
      } as unknown as ImageBitmap;
      vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        save: vi.fn(),
        fillRect: vi.fn(),
        restore: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
        (callback, type) =>
          callback(new Blob(["resized pixels"], { type: type ?? "image/png" })),
      );
      const resized = {
        type: "file" as const,
        name: "reference.png",
        mediaType: "image/png",
        url: "https://files.example.test/reference-resized.png",
      };
      chatMocks.control.uploadFiles
        .mockRejectedValueOnce(new Error("Raw storage provider failure"))
        .mockResolvedValueOnce([resized]);
      await mount(baseProps());
      const file = new File([largePngBytes()], "reference.png", {
        type: "image/png",
      });

      await act(async () => {
        await chatMocks.composerProps.onSubmit(
          "Use this reference",
          [file],
          [],
          {
            intent,
          },
        );
      });

      expect(bitmap.close).toHaveBeenCalledOnce();
      expect(chatMocks.control.uploadFiles).toHaveBeenCalledTimes(2);
      const sent = chatMocks.control.sendMessage.mock.calls[0]?.[0] as any;
      expect(sent.requestAttachments).toEqual([
        {
          type: "image",
          name: "reference.png",
          contentType: "image/png",
          data: "data:image/png;base64,cmVzaXplZCBwaXhlbHM=",
          url: resized.url,
        },
      ]);
      expect(sent.queuedWhileRunActive).toBe(intent === "queued");
      expect(sent.attachments).toEqual([]);
      expect(sent.metadata.custom.agentNativeRetryRequestAttachments).toEqual([
        {
          type: "image",
          name: "reference.png",
          contentType: "image/png",
          url: resized.url,
        },
      ]);
      expect(
        sent.metadata.custom.agentNativeRetryAttachmentsUnavailable,
      ).toBeUndefined();
      expect(JSON.stringify(sent)).not.toContain(
        "Raw storage provider failure",
      );
    },
  );

  it("surfaces missing storage before sending a downscaled image", async () => {
    const bitmap = {
      width: 2560,
      height: 1440,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      fillRect: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback, type) =>
        callback(new Blob(["resized pixels"], { type: type ?? "image/png" })),
    );
    chatMocks.fileUploadStatus = {
      data: { configured: false },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };
    await mount(baseProps());
    const file = new File([largePngBytes()], "reference.png", {
      type: "image/png",
    });

    await expect(
      chatMocks.composerProps.onSubmit("Use this reference", [file], [], {
        intent: "immediate",
      }),
    ).rejects.toMatchObject({
      message: "onboarding.fileStorage.title",
      code: "upload_storage_unavailable",
      retryable: false,
    });

    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(chatMocks.control.uploadFiles).not.toHaveBeenCalled();
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("surfaces failure when neither original nor resized image can be stored", async () => {
    const bitmap = {
      width: 2560,
      height: 1440,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      fillRect: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback, type) =>
        callback(new Blob(["resized pixels"], { type: type ?? "image/png" })),
    );
    const uploadError = Object.assign(
      new Error("agentChat.composer.uploadUnavailable"),
      { code: "upload_unavailable", retryable: true },
    );
    chatMocks.control.uploadFiles
      .mockRejectedValueOnce(uploadError)
      .mockRejectedValueOnce(uploadError);
    await mount(baseProps());
    const file = new File([largePngBytes()], "reference.png", {
      type: "image/png",
    });

    await expect(
      chatMocks.composerProps.onSubmit("Use this reference", [file], [], {
        intent: "immediate",
      }),
    ).rejects.toMatchObject({
      message: "agentChat.composer.uploadUnavailable",
      code: "upload_unavailable",
      retryable: true,
    });

    expect(chatMocks.control.uploadFiles).toHaveBeenCalledTimes(2);
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects oversized aggregate inline images before sending without storage", async () => {
    const bitmap = {
      width: 2560,
      height: 1440,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      fillRect: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback, type) =>
        callback(
          new Blob([new Uint8Array(2 * 1024 * 1024)], {
            type: type ?? "image/png",
          }),
        ),
    );
    chatMocks.fileUploadStatus = {
      data: { configured: false },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };
    await mount(baseProps());
    const files = ["reference-1.png", "reference-2.png", "reference-3.png"].map(
      (name) => new File([largePngBytes()], name, { type: "image/png" }),
    );

    await expect(
      chatMocks.composerProps.onSubmit("Use these references", files, [], {
        intent: "immediate",
      }),
    ).rejects.toThrow("agentChat.composer.requestTooLarge");

    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("localizes unsupported upload errors instead of exposing the HTTP status", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json(
          { error: "Unsupported file type: application/pdf" },
          { status: 415 },
        ),
      );
    await mount(baseProps());

    try {
      await expect(
        chatMocks.rootProps.clientOptions.upload(
          { uploadId: "upload-1", method: "POST", url: "/uploads" },
          {
            name: "reference.pdf",
            mediaType: "application/pdf",
            size: 4,
            body: new Blob(["data"], { type: "application/pdf" }),
          },
        ),
      ).rejects.toThrow("agentChat.composer.unsupportedFileType");
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      fetch.mockRestore();
    }
  });

  it("sends without waiting for pending-selection cleanup", async () => {
    chatMocks.appState.set("pending-selection-context", {
      text: "Selected text",
      capturedAt: Date.now(),
    });
    let resolveDelete!: () => void;
    vi.mocked(deleteClientAppState).mockImplementationOnce((key) => {
      return new Promise<void>((resolve) => {
        resolveDelete = () => {
          chatMocks.appState.delete(key);
          resolve();
        };
      });
    });
    await mount(baseProps());
    await flush();

    let submitPromise!: Promise<void>;
    await act(async () => {
      submitPromise = chatMocks.composerProps.onSubmit(
        "Send promptly",
        [],
        [],
        {},
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(resolveDelete).toBeDefined();
    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(chatMocks.control.sendMessage.mock.calls[0]?.[0]).toMatchObject({
      options: {
        metadata: { agentNativeSkipPendingSelectionContext: true },
      },
    });

    await act(async () => {
      resolveDelete();
      await submitPromise;
    });
    await flush();

    expect(chatMocks.appState.has("pending-selection-context")).toBe(false);
  });

  it.each(["immediate", "queued"])(
    "preserves pending selection when an %s send is rejected",
    async (intent) => {
      chatMocks.appState.set("pending-selection-context", {
        text: "Keep this selection",
        capturedAt: Date.now(),
      });
      const send = chatMocks.control.sendMessage;
      send.mockRejectedValueOnce(new Error("Send refused"));
      await mount(baseProps());
      await flush();
      await act(async () => {
        await expect(
          chatMocks.composerProps.onSubmit("Use selection", [], [], { intent }),
        ).rejects.toThrow("Send refused");
      });
      expect(deleteClientAppState).not.toHaveBeenCalledWith(
        "pending-selection-context",
        expect.anything(),
      );
      expect(chatMocks.appState.has("pending-selection-context")).toBe(true);
      await act(async () => {
        await chatMocks.composerProps.onSubmit("Retry", [], [], { intent });
      });
      expect(send.mock.calls[1]?.[0]?.text).toContain("Keep this selection");
      expect(chatMocks.appState.has("pending-selection-context")).toBe(false);
    },
  );

  it("keeps pending selection available when persisted cleanup fails", async () => {
    chatMocks.appState.set("pending-selection-context", {
      text: "retry selection",
      capturedAt: Date.now(),
    });
    vi.mocked(deleteClientAppState).mockRejectedValueOnce(
      new Error("network unavailable"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await mount(baseProps());
      await flush();

      await act(async () => {
        await chatMocks.composerProps.onSubmit("First attempt", [], [], {});
      });
      await flush();

      expect(chatMocks.appState.has("pending-selection-context")).toBe(true);
      expect(chatMocks.control.sendMessage.mock.calls[0]?.[0]?.text).toContain(
        "retry selection",
      );

      await act(async () => {
        await chatMocks.composerProps.onSubmit("Retry", [], [], {});
      });
      await flush();

      expect(chatMocks.control.sendMessage.mock.calls[1]?.[0]?.text).toContain(
        "retry selection",
      );
      expect(chatMocks.appState.has("pending-selection-context")).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    [
      413,
      { error: "File too large (max 25 MB)" },
      "agentChat.composer.fileTooLarge",
      "upload_too_large",
    ],
    [
      401,
      { error: "Unauthorized" },
      "agentChat.composer.sessionExpired",
      "upload_session_expired",
    ],
    [
      403,
      { error: "Forbidden" },
      "agentChat.composer.sessionExpired",
      "upload_session_expired",
    ],
    [
      429,
      { error: "Too many uploads" },
      "agentChat.composer.uploadUnavailable",
      "upload_unavailable",
    ],
    [
      503,
      {
        error: "Storage provider is unavailable. Check File uploads settings.",
      },
      "agentChat.composer.uploadUnavailable",
      "upload_unavailable",
    ],
    [
      400,
      { error: "No file uploaded" },
      "agentChat.composer.uploadFailed",
      "upload_http_400",
    ],
  ] as const)(
    "preserves actionable upload failures for HTTP %s",
    async (status, payload, message, code) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json(payload, { status }));
      await mount(baseProps());

      try {
        const error = await chatMocks.rootProps.clientOptions
          .upload(
            { uploadId: "upload-1", method: "POST", url: "/uploads" },
            {
              name: "reference.png",
              mediaType: "image/png",
              size: 4,
              body: new Blob(["data"], { type: "image/png" }),
            },
          )
          .catch((cause: unknown) => cause as Error);
        expect(error).toMatchObject({
          message,
          code,
          status,
          retryable: status === 429 || status >= 500,
        });
        expect(error.message).not.toContain(payload.error);
      } finally {
        fetch.mockRestore();
      }
    },
  );

  it("localizes an upload that never reached the server", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("Failed to fetch"));
    await mount(baseProps());

    try {
      await expect(
        chatMocks.rootProps.clientOptions.upload(
          { uploadId: "upload-1", method: "POST", url: "/uploads" },
          {
            name: "reference.png",
            mediaType: "image/png",
            size: 4,
            body: new Blob(["data"], { type: "image/png" }),
          },
        ),
      ).rejects.toMatchObject({
        message: "agentChat.composer.uploadOffline",
        code: "upload_network_error",
        retryable: true,
      });
    } finally {
      fetch.mockRestore();
    }
  });

  it("names a file over the upload limit before uploading anything", async () => {
    await mount(baseProps());
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    const huge = new File(["video"], "huge.mov", { type: "video/quicktime" });
    Object.defineProperty(huge, "size", { value: 26 * 1024 * 1024 });

    await act(async () => {
      await expect(
        chatMocks.composerProps.onSubmit("Review these", [notes, huge], [], {
          intent: "immediate",
        }),
      ).rejects.toMatchObject({
        message: "huge.mov: agentChat.composer.fileTooLarge",
        code: "upload_failed",
      });
    });

    expect(chatMocks.control.uploadFiles).not.toHaveBeenCalled();
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("reuses the files that uploaded when a sibling failed", async () => {
    await mount(baseProps());
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    const sheet = new File(["sheet"], "sheet.csv", { type: "text/csv" });
    const notesPart = {
      type: "file" as const,
      name: "notes.txt",
      mediaType: "text/plain",
      url: "https://files.example.test/notes.txt",
    };
    const sheetPart = {
      type: "file" as const,
      name: "sheet.csv",
      mediaType: "text/csv",
      url: "https://files.example.test/sheet.csv",
    };
    chatMocks.control.uploadFiles
      .mockRejectedValueOnce(
        new AgentKitUploadError(
          [
            {
              index: 1,
              name: "sheet.csv",
              error: new Error("agentChat.composer.uploadUnavailable"),
            },
          ],
          [{ index: 0, part: notesPart }],
        ),
      )
      .mockResolvedValueOnce([sheetPart]);

    await act(async () => {
      await expect(
        chatMocks.composerProps.onSubmit("Compare", [notes, sheet], [], {
          intent: "immediate",
        }),
      ).rejects.toThrow("sheet.csv: agentChat.composer.uploadUnavailable");
    });
    await act(async () => {
      await chatMocks.composerProps.onSubmit("Compare", [notes, sheet], [], {
        intent: "immediate",
      });
    });

    expect(chatMocks.control.uploadFiles).toHaveBeenCalledTimes(2);
    expect(chatMocks.control.uploadFiles.mock.calls[1]?.[0]).toMatchObject([
      { name: "sheet.csv" },
    ]);
    expect(
      chatMocks.control.sendMessage.mock.calls[0]?.[0].attachments,
    ).toEqual([notesPart, sheetPart]);
  });

  it("keeps an upload when provider readiness flips while it runs", async () => {
    const props = baseProps();
    await mount(props);
    const file = new File(["image"], "keep.png", { type: "image/png" });
    const uploading = Promise.withResolvers<FilePart[]>();
    chatMocks.control.uploadFiles.mockReturnValueOnce(uploading.promise);
    let submission!: Promise<void>;
    await act(async () => {
      submission = chatMocks.composerProps.onSubmit("Use this", [file], [], {
        intent: "immediate",
      });
      await vi.waitFor(() =>
        expect(chatMocks.control.uploadFiles).toHaveBeenCalledOnce(),
      );
    });

    await act(async () =>
      root.render(
        <AgentKitAssistantChat {...props} composerSubmissionDisabled />,
      ),
    );
    await act(async () => {
      uploading.resolve([
        {
          type: "file",
          name: "keep.png",
          mediaType: "image/png",
          url: "https://files.example.test/keep.png",
        },
      ]);
      await submission;
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(
      chatMocks.control.sendMessage.mock.calls[0]?.[0].attachments,
    ).toEqual([
      {
        type: "file",
        name: "keep.png",
        mediaType: "image/png",
        url: "https://files.example.test/keep.png",
      },
    ]);
  });

  it("stores no inline image bytes in thread or queue snapshots", async () => {
    const dataUrl = "data:image/png;base64,aGVsbG8=";
    chatMocks.thread.messages = [
      {
        id: "user-image",
        role: "user",
        createdAt: "2026-10-09T00:00:00.000Z",
        parts: [
          { type: "text", text: "Use this image" },
          {
            type: "file",
            name: "inline.png",
            mediaType: "image/png",
            url: dataUrl,
          },
          {
            type: "file",
            name: "durable.png",
            mediaType: "image/png",
            url: "https://files.example.test/durable.png",
          },
          {
            type: "file",
            name: "raw.png",
            mediaType: "image/png",
            url: "AQID",
          },
          {
            type: "file",
            name: "signed.png",
            mediaType: "image/png",
            url: "https://files.example.test/signed.png?token=secret",
          },
        ],
      },
    ];
    chatMocks.thread.events = [
      {
        type: "message.created",
        message: chatMocks.thread.messages[0],
      },
    ];
    chatMocks.thread.queuedMessages = [
      {
        id: "queued-image",
        threadId: "thread-1",
        text: "And this one",
        createdAt: "2026-10-09T00:00:01.000Z",
        attachments: [
          {
            type: "file",
            name: "queued.png",
            mediaType: "image/png",
            url: dataUrl,
          },
          {
            type: "file",
            name: "queued-signed.png",
            mediaType: "image/png",
            url: "https://files.example.test/queued.png?token=secret",
          },
        ],
        requestAttachments: [
          { type: "image", name: "pending.png", data: dataUrl },
          {
            type: "image",
            name: "resized.png",
            data: dataUrl,
            url: "https://files.example.test/resized.png",
          },
          {
            type: "image",
            name: "signed.png",
            url: "https://files.example.test/signed.png?token=secret",
          },
        ],
      },
    ];
    const ref = createRef<AssistantChatHandle>();
    await mount(
      baseProps({ createTransport: () => chatMocks.transport as never }),
      ref,
    );

    const snapshot = ref.current?.exportThreadSnapshot();
    const threadData = snapshot?.threadData ?? "";
    const saved = JSON.parse(threadData);

    expect(threadData).not.toContain("base64,");
    expect(threadData).not.toContain("data:image");
    expect(threadData).not.toContain("AQID");
    expect(threadData).not.toContain("token=secret");
    expect(saved.agentKit.messages[0].parts).toEqual([
      { type: "text", text: "Use this image" },
      {
        type: "file",
        name: "inline.png",
        mediaType: "image/png",
        omitted: "inline-bytes",
      },
      {
        type: "file",
        name: "durable.png",
        mediaType: "image/png",
        url: "https://files.example.test/durable.png",
      },
      {
        type: "file",
        name: "raw.png",
        mediaType: "image/png",
        omitted: "unsafe-url",
      },
      {
        type: "file",
        name: "signed.png",
        mediaType: "image/png",
        omitted: "unsafe-url",
      },
    ]);
    expect(saved.queuedMessages[0].requestAttachments).toEqual([
      {
        type: "image",
        name: "resized.png",
        url: "https://files.example.test/resized.png",
      },
    ]);
    expect(
      chatMocks.thread.messages[0].parts.some(
        (part: { url?: string }) => part.url === dataUrl,
      ),
    ).toBe(true);
  });

  it("uploads inline images before storing a deferred submission", async () => {
    chatMocks.history = { isRestoring: true };
    chatMocks.control.uploadFiles.mockResolvedValueOnce([
      {
        type: "file",
        name: "image",
        mediaType: "image/png",
        url: "https://files.example.test/image.png",
      },
    ]);
    const ref = createRef<AssistantChatHandle>();
    await mount(baseProps(), ref);

    await act(async () => {
      await ref.current?.sendMessage("Use this image", [
        "data:image/png;base64,aGVsbG8=",
      ]);
    });

    const stored = JSON.stringify([...chatMocks.appState.values()]);
    expect(chatMocks.control.uploadFiles).toHaveBeenCalledOnce();
    expect(stored).toContain("https://files.example.test/image.png");
    expect(stored).not.toContain("base64,");
    expect(stored).not.toContain("data:image");
  });

  it("rechecks only submission scope after upload and reports its reason", async () => {
    const uploading = Promise.withResolvers<FilePart[]>();
    chatMocks.control.uploadFiles.mockReturnValueOnce(uploading.promise);
    const ref = createRef<AssistantChatHandle>();
    const firstScope = { type: "design", id: "first" };
    await mount(baseProps({ contextScope: firstScope }), ref);
    chatMocks.fetchProviderState.mockClear();

    let submission!: Promise<void>;
    await act(async () => {
      submission = chatMocks.composerProps.onSubmit(
        "Analyze these notes",
        [
          new File(["Read the attached notes."], "notes.txt", {
            type: "text/plain",
          }),
        ],
        [],
        { intent: "immediate" },
      );
      await vi.waitFor(() =>
        expect(chatMocks.control.uploadFiles).toHaveBeenCalledOnce(),
      );
    });
    expect(chatMocks.fetchProviderState).toHaveBeenCalledOnce();

    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          {...baseProps({ contextScope: { type: "design", id: "second" } })}
          ref={ref}
        />,
      );
    });
    await act(async () => {
      uploading.resolve([
        {
          type: "file",
          name: "notes.txt",
          mediaType: "text/plain",
          url: "https://files.example.test/notes.txt",
        },
      ]);
      await expect(submission).rejects.toMatchObject({
        code: "submission_scope_changed",
      });
    });

    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(chatMocks.fetchProviderState).toHaveBeenCalledOnce();
  });

  it("does not clear persisted selection when hydration fails", async () => {
    chatMocks.appState.set("pending-selection-context", {
      text: "selection to preserve",
      capturedAt: Date.now(),
    });
    vi.mocked(readClientAppState).mockImplementation(async (key) => {
      if (key === "pending-selection-context") {
        throw new Error("network unavailable");
      }
      return chatMocks.appState.get(key) ?? null;
    });

    await mount(baseProps());
    await flush();

    await act(async () => {
      await chatMocks.composerProps.onSubmit(
        "Send without selection",
        [],
        [],
        {},
      );
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(chatMocks.control.sendMessage.mock.calls[0]?.[0]).toMatchObject({
      text: "Send without selection",
    });
    expect(
      chatMocks.control.sendMessage.mock.calls[0]?.[0]?.options?.metadata,
    ).not.toHaveProperty("agentNativeSkipPendingSelectionContext");
    expect(deleteClientAppState).not.toHaveBeenCalled();
    expect(chatMocks.appState.has("pending-selection-context")).toBe(true);
  });

  it("preserves a selection attached while composer files upload", async () => {
    let resolveUpload!: (
      parts: Awaited<ReturnType<typeof chatMocks.control.uploadFiles>>,
    ) => void;
    chatMocks.control.uploadFiles.mockImplementationOnce(
      () => new Promise((resolve) => (resolveUpload = resolve)),
    );
    await mount(baseProps());
    await flush();

    const image = new File(["image bytes"], "slide-image.png", {
      type: "image/png",
    });
    let submitPromise!: Promise<void>;
    await act(async () => {
      submitPromise = chatMocks.composerProps.onSubmit(
        "Describe this slide",
        [image],
        [],
        {
          attachments: [
            { id: "image-1", type: "image", name: image.name, file: image },
          ],
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const capturedAt = Date.now();
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-panel:selection-attached", {
          detail: { text: "New selection" },
        }),
      );
      chatMocks.appState.set("pending-selection-context", {
        text: "New selection",
        capturedAt,
      });
      resolveUpload([
        {
          type: "file",
          name: image.name,
          mediaType: image.type,
          url: "https://files.example.test/slide-image.png",
        },
      ]);
      await submitPromise;
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(chatMocks.control.sendMessage.mock.calls[0]?.[0]).toMatchObject({
      text: "Describe this slide",
      options: {
        metadata: { agentNativeSkipPendingSelectionContext: true },
      },
    });
    expect(deleteClientAppState).not.toHaveBeenCalled();
    expect(chatMocks.appState.get("pending-selection-context")).toEqual({
      text: "New selection",
      capturedAt,
    });
  });

  it("hydrates pending selection before constructing the send", async () => {
    let resolveSelectionRead!: (value: unknown) => void;
    vi.mocked(readClientAppState).mockImplementation(async (key) => {
      if (key === "pending-selection-context") {
        return await new Promise((resolve) => {
          resolveSelectionRead = resolve;
        });
      }
      return chatMocks.appState.get(key) ?? null;
    });
    await mount(baseProps());

    let submitPromise!: Promise<void>;
    await act(async () => {
      submitPromise = chatMocks.composerProps.onSubmit(
        "Use the selected text",
        [],
        [],
        {},
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(deleteClientAppState).not.toHaveBeenCalled();

    await act(async () => {
      resolveSelectionRead({
        value: { text: "Hydrated selection", capturedAt: Date.now() },
      });
      await submitPromise;
    });

    expect(chatMocks.control.sendMessage.mock.calls[0]?.[0]).toMatchObject({
      text: expect.stringContaining("Hydrated selection"),
      options: {
        metadata: { agentNativeSkipPendingSelectionContext: true },
      },
    });
  });

  it("rejects unresolved sends before uploading or queueing their attachments", async () => {
    chatMocks.readiness = {
      canChat: false,
      missing: false,
      state: "unknown",
    };
    const ref = createRef<AssistantChatHandle>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const props = baseProps({});
    await act(async () => {
      root.render(<AgentKitAssistantChat ref={ref} {...props} />);
    });
    const results: CustomEvent[] = [];
    const listener = (event: Event) => results.push(event as CustomEvent);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, listener);
    let sendResult!: AssistantChatSubmitResult;
    await act(async () => {
      ref.current?.prefillMessage("Visible composer draft");
      sendResult = await ref.current!.sendMessage(
        "Wait for the provider",
        undefined,
        {
          submitMessageId: "pending-provider-submit",
          attachments: [
            {
              type: "text/plain",
              name: "notes.txt",
              text: "private attachment body",
            },
          ],
        },
      );
    });
    expect(sendResult).toEqual({
      status: "rejected",
      reason: "submission-unavailable",
    });
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(results.map((event) => event.detail)).toEqual([
      {
        submitMessageId: "pending-provider-submit",
        delivered: false,
        reason: "submission-unavailable",
      },
    ]);
    expect(chatMocks.composerProps.initialText).toBe("Visible composer draft");
    expect(chatMocks.control.uploadFiles).not.toHaveBeenCalled();
    expect(
      [...chatMocks.appState.keys()].some((key) =>
        key.startsWith("agentkit-deferred-provider-submissions:"),
      ),
    ).toBe(false);
    window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, listener);
  });

  it("uploads data URL image references before persisting a deferred send", async () => {
    const threadId = chatMocks.threadId;
    const encodedThreadId = Array.from(threadId, (character) =>
      character.codePointAt(0)!.toString(16),
    ).join("-");
    const stateKey = `agentkit-deferred-provider-submissions:${encodedThreadId}`;
    const inlineImageUrl = "data:image/png;base64,aGVsbG8=";
    chatMocks.history = { isRestoring: true };
    chatMocks.control.uploadFiles.mockResolvedValueOnce([
      {
        type: "file",
        name: "reference.png",
        mediaType: "image/png",
        url: "https://files.example.test/reference.png",
      },
    ]);
    const ref = createRef<AssistantChatHandle>();
    await mount(baseProps(), ref);

    await act(async () => {
      await ref.current!.sendMessage("Describe this image", undefined, {
        attachments: [
          {
            type: "image",
            name: "reference.png",
            contentType: "image/png",
            url: inlineImageUrl,
          },
        ],
      });
    });

    const persisted = chatMocks.appState.get(stateKey) as any;
    expect(chatMocks.control.uploadFiles).toHaveBeenCalledOnce();
    expect(persisted.submissions[0].fileParts).toEqual([
      expect.objectContaining({
        type: "file",
        url: "https://files.example.test/reference.png",
      }),
    ]);
    expect(JSON.stringify(persisted)).not.toContain("data:image/");
    expect(JSON.stringify(persisted)).not.toContain("aGVsbG8=");
  });

  it("rejects an inline URL in a deferred recovery file part before persistence", async () => {
    chatMocks.history = { isRestoring: true };
    const ref = createRef<AssistantChatHandle>();
    await mount(baseProps(), ref);

    await act(async () => {
      await expect(
        ref.current!.sendRecoveryMessage(
          "Continue with this image",
          "continue",
          ["data:image/png;base64,INLINE_RECOVERY_BYTES"],
        ),
      ).rejects.toThrow("did not receive a durable reference");
    });

    expect(
      [...chatMocks.appState.keys()].some((key) =>
        key.startsWith("agentkit-deferred-provider-submissions:"),
      ),
    ).toBe(false);
    expect(JSON.stringify([...chatMocks.appState.values()])).not.toContain(
      "INLINE_RECOVERY_BYTES",
    );
  });

  it.each(["references", "composerOptions", "options"] as const)(
    "rejects nested inline image payloads in deferred %s before the app-state CAS",
    async (location) => {
      const threadId = `thread-deferred-${location}`;
      const encodedThreadId = Array.from(threadId, (character) =>
        character.codePointAt(0)!.toString(16),
      ).join("-");
      const stateKey = `agentkit-deferred-provider-submissions:${encodedThreadId}`;
      vi.mocked(compareAndSetClientAppState).mockClear();

      const inlineImageUrl = "data:image/png;base64,DEFERRED_SQL_IMAGE_BYTES";
      const rawImageBytesBase64 = "A".repeat(128);
      const submission: any = {
        id: `deferred-${location}`,
        threadId,
        text: "Use this reference",
        fileParts: [],
        references: [],
        composerOptions: {},
        options: {},
      };
      if (location === "references") {
        submission.references = [
          {
            type: "file",
            path: "/reference.png",
            name: "reference.png",
            source: "resource",
            metadata: { preview: inlineImageUrl },
          },
        ];
      } else if (location === "composerOptions") {
        submission.composerOptions = {
          contextItems: [
            {
              key: "reference",
              title: "Reference",
              context: "Selected reference",
              preview: inlineImageUrl,
            },
          ],
        };
      } else {
        submission.options = {
          image: { base64: rawImageBytesBase64 },
        };
      }

      await expect(
        updateDeferredProviderSubmissions(threadId, () => [submission]),
      ).rejects.toThrow(
        location === "options"
          ? "inline image bytes cannot be persisted"
          : "inline attachment data cannot be persisted",
      );

      expect(compareAndSetClientAppState).not.toHaveBeenCalled();
      expect(chatMocks.appState.has(stateKey)).toBe(false);
      expect(JSON.stringify([...chatMocks.appState.values()])).not.toContain(
        "DEFERRED_SQL_IMAGE_BYTES",
      );
      expect(JSON.stringify([...chatMocks.appState.values()])).not.toContain(
        rawImageBytesBase64,
      );
    },
  );

  it("allows pasted data URL examples in deferred message text", async () => {
    const threadId = `thread-deferred-text-example`;
    const text = `Example image URL: data:image/png;base64,${"A".repeat(128)}`;
    const submission = {
      id: "deferred-text-example",
      threadId,
      text,
      fileParts: [],
      references: [],
      composerOptions: {},
      options: {},
    };

    await expect(
      updateDeferredProviderSubmissions(threadId, () => [submission]),
    ).resolves.toEqual([submission]);
  });

  it.each(["dataURL", "body"] as const)(
    "rejects raw image bytes under a deferred %s field",
    async (fieldName) => {
      const threadId = `thread-deferred-${fieldName}`;
      const submission = {
        id: `deferred-${fieldName}`,
        threadId,
        text: "Describe this image",
        fileParts: [],
        references: [],
        composerOptions: {},
        options: { image: { [fieldName]: "A".repeat(128) } },
      };

      await expect(
        updateDeferredProviderSubmissions(threadId, () => [submission]),
      ).rejects.toThrow("inline image bytes cannot be persisted");
    },
  );

  it("cleans legacy deferred image bytes and surfaces a reattach action", async () => {
    const threadId = chatMocks.threadId;
    const encodedThreadId = Array.from(threadId, (character) =>
      character.codePointAt(0)!.toString(16),
    ).join("-");
    const stateKey = `agentkit-deferred-provider-submissions:${encodedThreadId}`;
    const inlineImageUrl = "data:image/png;base64,LEGACY_DEFERRED_IMAGE_BYTES";
    chatMocks.appState.set(stateKey, {
      version: 1,
      threadId,
      submissions: [
        {
          id: "legacy-deferred-image",
          threadId,
          text: "Describe this image",
          fileParts: [],
          requestAttachments: [
            {
              type: "image",
              name: "reference.png",
              contentType: "image/png",
              data: inlineImageUrl,
            },
          ],
          references: [],
          composerOptions: {},
          options: {
            deferredRequestAttachments: [
              {
                type: "image",
                name: "reference.png",
                contentType: "image/png",
                data: inlineImageUrl,
              },
            ],
          },
        },
      ],
    });

    await mount(baseProps());
    await flush();

    const persisted = chatMocks.appState.get(stateKey);
    expect(JSON.stringify(persisted)).not.toContain("data:image");
    expect(persisted).toMatchObject({
      submissions: [
        {
          failed: true,
          attachmentRestoreRequired: true,
          requestAttachments: [],
          options: { deferredRequestAttachments: [] },
        },
      ],
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "agentChat.recovery.retryAttachmentUnavailable",
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "agentChat.common.retry",
      ),
    ).toBe(false);
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps deferred image options with a durable ref during legacy cleanup", async () => {
    const threadId = chatMocks.threadId;
    const encodedThreadId = Array.from(threadId, (character) =>
      character.codePointAt(0)!.toString(16),
    ).join("-");
    const stateKey = `agentkit-deferred-provider-submissions:${encodedThreadId}`;
    const inlineImageUrl = "data:image/png;base64,LEGACY_DEFERRED_IMAGE_BYTES";
    const referenceUrl = "https://files.example.test/reference.png";
    vi.mocked(compareAndSetClientAppState).mockClear();
    chatMocks.appState.set(stateKey, {
      version: 1,
      threadId,
      submissions: [
        {
          id: "legacy-deferred-image-with-durable-ref",
          threadId,
          text: "Describe this image",
          fileParts: [
            {
              type: "file",
              name: "reference.png",
              mediaType: "image/png",
              url: referenceUrl,
            },
          ],
          requestAttachments: [
            {
              type: "image",
              name: "reference.png",
              contentType: "image/png",
              url: referenceUrl,
            },
          ],
          references: [],
          composerOptions: {},
          options: {
            deferredFileParts: [
              {
                type: "file",
                name: "reference.png",
                mediaType: "image/png",
                url: referenceUrl,
                data: inlineImageUrl,
              },
            ],
            deferredRequestAttachments: [
              {
                type: "image",
                name: "reference.png",
                contentType: "image/png",
                referenceUrl,
                data: inlineImageUrl,
              },
            ],
          },
        },
      ],
    });

    await mount(baseProps());
    await flush();

    const stateWrites = vi
      .mocked(compareAndSetClientAppState)
      .mock.calls.filter(([key]) => key === stateKey);
    expect(stateWrites.length).toBeGreaterThan(0);
    expect(JSON.stringify(stateWrites.map(([, , next]) => next))).not.toContain(
      "data:image",
    );
    expect(chatMocks.appState.has(stateKey)).toBe(false);
    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
    expect(request.attachments).toContainEqual({
      type: "file",
      name: "reference.png",
      mediaType: "image/png",
      url: referenceUrl,
    });
    expect(request.requestAttachments).toContainEqual({
      type: "image",
      name: "reference.png",
      contentType: "image/png",
      url: referenceUrl,
    });
  });

  it("still marks inline bytes in unrelated deferred options as unrecoverable", async () => {
    const threadId = chatMocks.threadId;
    const encodedThreadId = Array.from(threadId, (character) =>
      character.codePointAt(0)!.toString(16),
    ).join("-");
    const stateKey = `agentkit-deferred-provider-submissions:${encodedThreadId}`;
    const inlineImageUrl = "data:image/png;base64,LEGACY_OPTION_IMAGE_BYTES";
    chatMocks.appState.set(stateKey, {
      version: 1,
      threadId,
      submissions: [
        {
          id: "legacy-deferred-unrelated-option-payload",
          threadId,
          text: "Describe this image",
          fileParts: [],
          references: [],
          composerOptions: {},
          options: {
            deferredRequestAttachments: [
              {
                type: "image",
                name: "reference.png",
                url: "https://files.example.test/reference.png",
                data: inlineImageUrl,
              },
            ],
            unrelatedPayload: { image: inlineImageUrl },
          },
        },
      ],
    });

    await mount(baseProps());
    await flush();

    expect(chatMocks.appState.get(stateKey)).toMatchObject({
      submissions: [{ failed: true, attachmentRestoreRequired: true }],
    });
    expect(JSON.stringify(chatMocks.appState.get(stateKey))).not.toContain(
      "data:image",
    );
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("marks a legacy inline reference lost when only an unrelated file remains", async () => {
    const threadId = chatMocks.threadId;
    const encodedThreadId = Array.from(threadId, (character) =>
      character.codePointAt(0)!.toString(16),
    ).join("-");
    const stateKey = `agentkit-deferred-provider-submissions:${encodedThreadId}`;
    const inlineImageUrl = "data:image/png;base64,LEGACY_REFERENCE_IMAGE_BYTES";
    chatMocks.appState.set(stateKey, {
      version: 1,
      threadId,
      submissions: [
        {
          id: "legacy-reference-with-unrelated-file",
          threadId,
          text: "Describe this reference",
          fileParts: [
            {
              type: "file",
              name: "notes.txt",
              mediaType: "text/plain",
              url: "https://files.example.test/notes.txt",
            },
          ],
          requestAttachments: [],
          references: [
            {
              type: "file",
              path: "/reference.png",
              name: "reference.png",
              source: "resource",
              metadata: { preview: inlineImageUrl },
            },
          ],
          composerOptions: {},
          options: {},
        },
      ],
    });

    await mount(baseProps());
    await flush();

    expect(chatMocks.appState.get(stateKey)).toMatchObject({
      submissions: [
        {
          failed: true,
          attachmentRestoreRequired: true,
          fileParts: [{ name: "notes.txt" }],
        },
      ],
    });
    expect(JSON.stringify(chatMocks.appState.get(stateKey))).not.toContain(
      "data:image",
    );
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps a legacy inline reference when its matching durable image remains", async () => {
    const threadId = chatMocks.threadId;
    const encodedThreadId = Array.from(threadId, (character) =>
      character.codePointAt(0)!.toString(16),
    ).join("-");
    const stateKey = `agentkit-deferred-provider-submissions:${encodedThreadId}`;
    const inlineImageUrl = "data:image/png;base64,LEGACY_REFERENCE_IMAGE_BYTES";
    const referenceUrl = "https://files.example.test/reference.png";
    chatMocks.appState.set(stateKey, {
      version: 1,
      threadId,
      submissions: [
        {
          id: "legacy-reference-with-durable-image",
          threadId,
          text: "Describe this reference",
          fileParts: [
            {
              type: "file",
              name: "reference.png",
              mediaType: "image/png",
              url: referenceUrl,
            },
          ],
          requestAttachments: [],
          references: [
            {
              type: "file",
              path: "/reference.png",
              name: "reference.png",
              source: "resource",
              metadata: { preview: inlineImageUrl },
            },
          ],
          composerOptions: {},
          options: {},
        },
      ],
    });

    await mount(baseProps());
    await flush();

    expect(chatMocks.appState.has(stateKey)).toBe(false);
    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(
      chatMocks.control.sendMessage.mock.calls[0]?.[0].attachments,
    ).toContainEqual({
      type: "file",
      name: "reference.png",
      mediaType: "image/png",
      url: referenceUrl,
    });
  });

  it("keeps a failed deferred send visible until the user retries or dismisses it", async () => {
    const threadId = chatMocks.threadId;
    const encodedThreadId = Array.from(threadId, (character) =>
      character.codePointAt(0)!.toString(16),
    ).join("-");
    const stateKey = `agentkit-deferred-provider-submissions:${encodedThreadId}`;
    chatMocks.appState.set(stateKey, {
      version: 1,
      threadId,
      submissions: [
        {
          id: "deferred-failed-send",
          threadId,
          text: "Send this after reconnecting",
          fileParts: [],
          references: [],
          composerOptions: {},
          options: {},
        },
      ],
    });
    chatMocks.control.sendMessage.mockRejectedValueOnce(
      Object.assign(new Error("Bad request"), { status: 400 }),
    );

    await mount(baseProps());
    await flush();

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "agentChat.recovery.deferredSubmissionFailed",
    );

    chatMocks.control.sendMessage.mockResolvedValue(undefined);
    const retryButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "agentChat.common.retry",
    );
    expect(retryButton).toBeDefined();
    await act(async () => retryButton!.click());
    await flush();

    expect(chatMocks.control.sendMessage).toHaveBeenCalledTimes(2);
    expect(chatMocks.appState.has(stateKey)).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("releases a deferred-send claim after an unmounted dispatch fails", async () => {
    const threadId = chatMocks.threadId;
    const encodedThreadId = Array.from(threadId, (character) =>
      character.codePointAt(0)!.toString(16),
    ).join("-");
    const stateKey = `agentkit-deferred-provider-submissions:${encodedThreadId}`;
    chatMocks.appState.set(stateKey, {
      version: 1,
      threadId,
      submissions: [
        {
          id: "deferred-unmount-send",
          threadId,
          text: "Send this after reconnecting",
          fileParts: [],
          references: [],
          composerOptions: {},
          options: {},
        },
      ],
    });
    let rejectDispatch!: (error: unknown) => void;
    chatMocks.control.sendMessage.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDispatch = reject;
        }),
    );

    await mount(baseProps());
    await flush();
    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(
      (chatMocks.appState.get(stateKey) as any).submissions[0].claim.token,
    ).toBeTruthy();

    await unmount();
    root = undefined as unknown as Root;
    await act(async () => {
      rejectDispatch(
        Object.assign(new Error("Gateway unavailable"), { status: 503 }),
      );
    });
    await flush();

    expect(
      (chatMocks.appState.get(stateKey) as any).submissions[0],
    ).toMatchObject({
      attempts: 1,
    });
    expect(
      (chatMocks.appState.get(stateKey) as any).submissions[0].claim,
    ).toBeUndefined();

    await mount(baseProps());
    await flush();
    expect(chatMocks.control.sendMessage).toHaveBeenCalledTimes(2);
    expect(chatMocks.appState.has(stateKey)).toBe(false);
  });

  it("preserves another tab's live claim when retrying a stale deferred failure", async () => {
    const threadId = chatMocks.threadId;
    const encodedThreadId = Array.from(threadId, (character) =>
      character.codePointAt(0)!.toString(16),
    ).join("-");
    const stateKey = `agentkit-deferred-provider-submissions:${encodedThreadId}`;
    chatMocks.appState.set(stateKey, {
      version: 1,
      threadId,
      submissions: [
        {
          id: "deferred-other-tab-claim",
          threadId,
          text: "Send this after reconnecting",
          fileParts: [],
          references: [],
          composerOptions: {},
          options: {},
          failed: true,
        },
      ],
    });

    await mount(baseProps());
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "agentChat.recovery.deferredSubmissionFailed",
    );

    const persisted = chatMocks.appState.get(stateKey) as any;
    const { failed: _failed, ...retryable } = persisted.submissions[0];
    chatMocks.appState.set(stateKey, {
      ...persisted,
      submissions: [
        {
          ...retryable,
          claim: { token: "other-tab", expiresAt: Date.now() + 60_000 },
        },
      ],
    });
    const retryButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "agentChat.common.retry",
    );
    expect(retryButton).toBeDefined();
    await act(async () => retryButton!.click());
    await flush();

    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(
      (chatMocks.appState.get(stateKey) as any).submissions[0].claim,
    ).toEqual({ token: "other-tab", expiresAt: expect.any(Number) });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not loop when the dev checkpoint sees an empty thread", async () => {
    chatMocks.readThread = () => ({
      ...chatMocks.thread,
      messages: [...chatMocks.thread.messages],
      activeRunIds: [...chatMocks.thread.activeRunIds],
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await mount(baseProps());

    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes("Maximum update depth exceeded"),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it("keeps an injected runtime stable until the host reload key changes", async () => {
    const customRuntime = { kind: "external-agent" } as never;
    const updatedRuntime = { kind: "external-agent", version: 2 } as never;
    await mount(
      baseProps({
        runtime: customRuntime,
        adapterReloadKey: "runtime-1",
        selectedModel: "model-1",
      }),
    );
    const transport = chatMocks.rootProps.transport;

    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          {...baseProps({
            runtime: updatedRuntime,
            adapterReloadKey: "runtime-1",
            selectedModel: "model-2",
          })}
        />,
      );
    });

    expect(chatMocks.createTransport).toHaveBeenCalledOnce();
    expect(chatMocks.transportOptions.runtime).toBe(customRuntime);
    expect(chatMocks.createRuntime).not.toHaveBeenCalled();
    expect(chatMocks.rootProps.transport).toBe(transport);

    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          {...baseProps({
            runtime: updatedRuntime,
            adapterReloadKey: "runtime-2",
            selectedModel: "model-2",
          })}
        />,
      );
    });

    expect(chatMocks.createTransport).toHaveBeenCalledTimes(2);
    expect(chatMocks.transportOptions.runtime).toBe(updatedRuntime);
  });

  it("keeps scoped history isolation current on the stable built-in transport", async () => {
    await mount(
      baseProps({
        contextScope: { type: "workspace-app", id: "app-one" },
        isolateHistoryByScope: true,
      }),
    );
    const transport = chatMocks.rootProps.transport;

    expect(chatMocks.createTransport).toHaveBeenCalledOnce();
    expect(chatMocks.transportOptions).toMatchObject({
      isolateHistoryByScope: true,
      scope: { type: "workspace-app", id: "app-one" },
    });

    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          {...baseProps({
            contextScope: { type: "workspace-app", id: "app-two" },
            isolateHistoryByScope: false,
          })}
        />,
      );
    });

    expect(chatMocks.rootProps.transport).toBe(transport);
    expect(chatMocks.createTransport).toHaveBeenCalledOnce();
    expect(chatMocks.transportOptions.isolateHistoryByScope).toBe(false);
    expect(chatMocks.transportOptions.scope).toEqual({
      type: "workspace-app",
      id: "app-two",
    });
  });

  it("acknowledges accepted sends after transport acceptance", async () => {
    const ref = createRef<AssistantChatHandle>();
    let resolveSend!: () => void;
    chatMocks.control.sendMessage.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveSend = resolve)),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<AgentKitAssistantChat ref={ref} {...baseProps()} />);
    });
    const results: CustomEvent[] = [];
    const listener = (event: Event) => results.push(event as CustomEvent);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, listener);
    let sendResult:
      | Awaited<ReturnType<AssistantChatHandle["sendMessage"]>>
      | undefined;
    let sendPromise: ReturnType<AssistantChatHandle["sendMessage"]> | undefined;

    await act(async () => {
      sendPromise = ref.current!.sendMessage("Create the draft", undefined, {
        submitMessageId: "submit-1",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(results).toHaveLength(0);

    await act(async () => {
      resolveSend();
      sendResult = await sendPromise!;
    });

    expect(sendResult).toEqual({ status: "submitted" });
    expect(results.map((event) => event.detail)).toEqual([
      { submitMessageId: "submit-1", delivered: true },
    ]);
    window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, listener);
  });

  it("reports an attachment with nothing to upload as its own failed-send reason", async () => {
    const ref = createRef<AssistantChatHandle>();
    await mount(baseProps(), ref);
    const results: CustomEvent[] = [];
    const listener = (event: Event) => results.push(event as CustomEvent);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, listener);

    await act(async () => {
      await ref
        .current!.sendMessage("Use my notes", undefined, {
          submitMessageId: "submit-empty-attachment",
          attachments: [{ type: "file", name: "notes.txt" }],
        })
        .catch(() => undefined);
    });

    window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, listener);
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(results.map((event) => event.detail)).toEqual([
      {
        submitMessageId: "submit-empty-attachment",
        delivered: false,
        reason: "attachment-unreadable",
      },
    ]);
  });

  it("uploads imperative queued images before sending durable URL references", async () => {
    const ref = createRef<AssistantChatHandle>();
    const imageDataUrl = "data:image/png;base64,SGVsbG8=";
    const uploadedImage: FilePart = {
      type: "file",
      name: "image-1",
      mediaType: "image/png",
      url: "https://files.example.test/queued-image.png",
    };
    const steps: string[] = [];
    chatMocks.control.uploadFiles.mockImplementation(async () => {
      steps.push("upload");
      return [uploadedImage];
    });
    chatMocks.control.queueMessage.mockImplementation(async () => {
      steps.push("queue");
      return undefined;
    });
    await mount(baseProps(), ref);

    let result:
      | Awaited<ReturnType<AssistantChatHandle["queueMessage"]>>
      | undefined;
    await act(async () => {
      result = await ref.current!.queueMessage("Describe this later", [
        imageDataUrl,
      ]);
    });

    const queuedRequest = chatMocks.control.queueMessage.mock.calls[0]?.[0] as
      | Record<string, any>
      | undefined;
    expect(result).toEqual({ status: "submitted" });
    expect(steps).toEqual(["upload", "queue"]);
    expect(queuedRequest).toMatchObject({
      text: "Describe this later",
      attachments: [uploadedImage],
      requestAttachments: [
        {
          type: "image",
          name: "image-1",
          contentType: "image/png",
          url: uploadedImage.url,
        },
      ],
    });
    expect(queuedRequest?.requestAttachments?.[0]).not.toHaveProperty("data");
    expect(JSON.stringify(queuedRequest)).not.toContain(imageDataUrl);
  });

  it("uploads oversized queued inline images before applying request limits", async () => {
    const ref = createRef<AssistantChatHandle>();
    const imageDataUrl = `data:image/png;base64,${"A".repeat(
      MAX_AGENT_REQUEST_ATTACHMENT_DATA_CHARS + 4,
    )}`;
    const uploadedImage: FilePart = {
      type: "file",
      name: "image-1",
      mediaType: "image/png",
      url: "https://files.example.test/queued-image.png",
    };
    const steps: string[] = [];
    chatMocks.control.uploadFiles.mockImplementation(async () => {
      steps.push("upload");
      return [uploadedImage];
    });
    chatMocks.control.queueMessage.mockImplementation(async () => {
      steps.push("queue");
      return undefined;
    });
    await mount(baseProps(), ref);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(new Blob(["image pixels"], { type: "image/png" })),
      );

    try {
      let result:
        | Awaited<ReturnType<AssistantChatHandle["queueMessage"]>>
        | undefined;
      await act(async () => {
        result = await ref.current!.queueMessage("Describe this later", [
          imageDataUrl,
        ]);
      });

      const queuedRequest = chatMocks.control.queueMessage.mock.calls[0]?.[0];
      expect(result).toEqual({ status: "submitted" });
      expect(steps).toEqual(["upload", "queue"]);
      expect(queuedRequest?.requestAttachments).toEqual([
        {
          type: "image",
          name: "image-1",
          contentType: "image/png",
          url: uploadedImage.url,
        },
      ]);
      expect(JSON.stringify(queuedRequest)).not.toContain(imageDataUrl);
    } finally {
      fetch.mockRestore();
    }
  });

  it("sends a small inline image immediately when file storage is unavailable", async () => {
    const ref = createRef<AssistantChatHandle>();
    const imageDataUrl = "data:image/png;base64,SGVsbG8=";
    chatMocks.fileUploadStatus = {
      data: { configured: false },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };
    await mount(baseProps(), ref);

    const result = await ref.current!.sendMessage("Describe this image", [
      imageDataUrl,
    ]);

    expect(result).toEqual({ status: "submitted" });
    expect(chatMocks.control.uploadFiles).not.toHaveBeenCalled();
    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
    expect(request.attachments).toEqual([]);
    expect(request.requestAttachments).toEqual([
      expect.objectContaining({
        type: "image",
        contentType: "image/png",
        data: imageDataUrl,
      }),
    ]);
    expect(request.metadata.custom).toEqual({
      agentNativeRetryAttachmentsUnavailable: true,
    });
    expect(JSON.stringify(request.metadata)).not.toContain(imageDataUrl);
  });

  it("rolls back and displays an error when imperative image storage fails", async () => {
    const ref = createRef<AssistantChatHandle>();
    chatMocks.control.uploadFiles.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await mount(baseProps(), ref);

    await act(async () => {
      await expect(
        ref.current!.queueMessage("Describe this later", [
          "data:image/png;base64,SGVsbG8=",
        ]),
      ).rejects.toThrow("storage unavailable");
    });

    expect(chatMocks.control.queueMessage).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "agentChat.error.failed",
    );
  });

  it.each([
    {
      code: "upload_too_large",
      message: "agentChat.composer.fileTooLarge",
    },
    {
      code: "upload_session_expired",
      message: "agentChat.composer.sessionExpired",
    },
  ])(
    "keeps typed upload failure visible and rolls back its reservation ($code)",
    async ({ code, message }) => {
      const ref = createRef<AssistantChatHandle>();
      const reserve = vi.fn(() => ({ id: "reserved-upload" }));
      const cancel = vi.fn();
      chatMocks.control.reserveQueuedMessage = reserve;
      chatMocks.control.cancelQueuedMessageReservation = cancel;
      chatMocks.control.uploadFiles.mockRejectedValueOnce(
        Object.assign(new Error(message), { code }),
      );
      await mount(baseProps(), ref);

      await act(async () => {
        await expect(
          ref.current!.queueMessage("Describe this later", [
            "data:image/png;base64,SGVsbG8=",
          ]),
        ).rejects.toThrow(message);
      });

      expect(reserve).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledWith("reserved-upload");
      expect(chatMocks.control.queueMessage).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        message,
      );
    },
  );

  it("checks setup before uploading an imperative queued image", async () => {
    chatMocks.readiness = {
      canChat: false,
      missing: true,
      state: "missing",
    };
    const ref = createRef<AssistantChatHandle>();
    await mount(baseProps(), ref);

    let result:
      | Awaited<ReturnType<AssistantChatHandle["queueMessage"]>>
      | undefined;
    await act(async () => {
      result = await ref.current!.queueMessage("Describe this later", [
        "data:image/png;base64,SGVsbG8=",
      ]);
    });

    expect(result).toEqual({
      status: "rejected",
      reason: "engine-not-configured",
    });
    expect(chatMocks.control.uploadFiles).not.toHaveBeenCalled();
    expect(chatMocks.control.queueMessage).not.toHaveBeenCalled();
  });

  it("returns typed rejection results for imperative sends while the engine is unavailable", async () => {
    chatMocks.readiness = {
      canChat: false,
      missing: true,
      state: "missing",
    };
    const ref = createRef<AssistantChatHandle>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<AgentKitAssistantChat ref={ref} {...baseProps({})} />);
    });
    const results: CustomEvent[] = [];
    const listener = (event: Event) => results.push(event as CustomEvent);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, listener);

    let sendResult:
      | Awaited<ReturnType<AssistantChatHandle["sendMessage"]>>
      | undefined;
    await act(async () => {
      sendResult = await ref.current?.sendMessage("Save the draft", undefined, {
        submitMessageId: "blocked-submit",
      });
    });
    let recoveryResult:
      | Awaited<ReturnType<AssistantChatHandle["sendRecoveryMessage"]>>
      | undefined;
    await act(async () => {
      recoveryResult = await ref.current?.sendRecoveryMessage(
        "Continue the task.",
        "continue",
      );
    });
    let queueResult:
      | Awaited<ReturnType<AssistantChatHandle["queueMessage"]>>
      | undefined;
    await act(async () => {
      queueResult = await ref.current?.queueMessage("Send this next");
    });

    expect(sendResult).toEqual({
      status: "rejected",
      reason: "engine-not-configured",
    });
    expect(recoveryResult).toEqual(sendResult);
    expect(queueResult).toEqual(sendResult);
    expect(results.map((event) => event.detail)).toEqual([
      {
        submitMessageId: "blocked-submit",
        delivered: false,
        reason: "engine-not-configured",
      },
    ]);
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(chatMocks.control.queueMessage).not.toHaveBeenCalled();

    chatMocks.readiness = {
      canChat: false,
      missing: false,
      state: "unavailable",
    };
    await act(async () => {
      root.render(<AgentKitAssistantChat ref={ref} {...baseProps({})} />);
    });
    await act(async () => {
      await expect(
        ref.current!.sendMessage("Try again", undefined, {
          submitMessageId: "unavailable-submit",
        }),
      ).resolves.toEqual({
        status: "rejected",
        reason: "submission-unavailable",
      });
    });
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(results.at(-1)?.detail).toEqual({
      submitMessageId: "unavailable-submit",
      delivered: false,
      reason: "submission-unavailable",
    });

    chatMocks.fetchProviderState.mockResolvedValue("configured");
    await act(async () => {
      root.render(<AgentKitAssistantChat ref={ref} {...baseProps({})} />);
      await expect(
        ref.current!.sendMessage("Try again after fresh check"),
      ).resolves.toEqual({ status: "submitted" });
    });
    expect(chatMocks.control.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Try again after fresh check" }),
    );
    window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, listener);
  });

  it("queues imperative and guided sends while a run is active", async () => {
    chatMocks.thread.activeRunIds = ["run-1"];
    const ref = createRef<AssistantChatHandle>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<AgentKitAssistantChat ref={ref} {...baseProps()} />);
    });

    await act(async () => {
      await ref.current?.sendMessage("Next imperative turn");
    });
    const guided = chatMocks.guidedOptions as {
      onSubmitMessage: (input: {
        message: string;
        context: string;
      }) => Promise<unknown>;
    };
    await act(async () => {
      await guided.onSubmitMessage({
        message: "Next guided turn",
        context: "",
      });
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledTimes(2);
    expect(chatMocks.control.sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        text: "Next imperative turn",
        queuedWhileRunActive: true,
      }),
    );
    expect(chatMocks.control.sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        text: "Next guided turn",
        queuedWhileRunActive: true,
      }),
    );
    expect(chatMocks.control.queueMessage).not.toHaveBeenCalled();
  });

  it("hides the shared guided-question card when the host owns that flow", async () => {
    chatMocks.guidedQuestions = [{ id: "question-1", question: "Title?" }];
    await mount(baseProps({ showGuidedQuestions: false }));

    expect(chatMocks.guidedOptions).toMatchObject({ enabled: false });
    expect(chatMocks.guidedFlowProps).toBeNull();
  });

  it("sends directly when a stale composer render outlives the queued run", async () => {
    chatMocks.thread.activeRunIds = ["run-queued-follow-up"];
    chatMocks.thread.runs = {
      "run-queued-follow-up": {
        id: "run-queued-follow-up",
        status: "running",
        lastSequence: 1,
      },
    };
    const ref = createRef<AssistantChatHandle>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<AgentKitAssistantChat ref={ref} {...baseProps()} />);
    });

    await act(async () => {
      await ref.current?.sendMessage("Queue while the follow-up is active");
    });
    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(chatMocks.control.sendMessage.mock.calls[0]?.[0]).toMatchObject({
      text: "Queue while the follow-up is active",
      queuedWhileRunActive: true,
    });

    chatMocks.thread.runs["run-queued-follow-up"].status = "completed";
    await act(async () => {
      await ref.current?.sendMessage("Send directly after completion");
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Send directly after completion" }),
    );
    expect(chatMocks.control.sendMessage).toHaveBeenCalledTimes(2);
    expect(chatMocks.control.sendMessage.mock.calls[1]?.[0]).toMatchObject({
      text: "Send directly after completion",
      queuedWhileRunActive: false,
    });
  });

  it("queues an unresolved approval and sends directly after its resolution event", async () => {
    chatMocks.thread.activeRunIds = ["approval-run"];
    chatMocks.thread.runs = {
      "approval-run": {
        id: "approval-run",
        status: "awaiting_approval",
        lastSequence: 2,
      },
    };
    chatMocks.thread.events = [
      {
        id: "approval-requested",
        threadId: "thread-1",
        runId: "approval-run",
        sequence: 1,
        occurredAt: "2026-08-29T00:00:00.000Z",
        type: "approval.requested",
        request: { id: "approval-1", title: "Continue?" },
      },
    ];
    chatMocks.thread.approvalRunIds = {};
    const ref = createRef<AssistantChatHandle>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<AgentKitAssistantChat ref={ref} {...baseProps()} />);
    });

    await act(async () => {
      await ref.current?.sendMessage("Queue during approval");
    });
    expect(chatMocks.control.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Queue during approval",
        queuedWhileRunActive: true,
      }),
    );

    chatMocks.thread.events.push({
      id: "approval-resolved",
      threadId: "thread-1",
      runId: "continuation-run",
      sequence: 1,
      occurredAt: "2026-08-29T00:00:01.000Z",
      type: "approval.resolved",
      approvalId: "approval-1",
      response: { decision: "approve" },
    });
    await act(async () => {
      await ref.current?.sendMessage("Send after approval");
      const guided = chatMocks.guidedOptions as {
        onSubmitMessage: (input: {
          message: string;
          context: string;
        }) => Promise<unknown>;
      };
      await guided.onSubmitMessage({
        message: "Guided send after approval",
        context: "",
      });
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Send after approval" }),
    );
    expect(chatMocks.control.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Guided send after approval" }),
    );
    expect(chatMocks.control.queueMessage).not.toHaveBeenCalled();
  });

  it("forwards slash commands, skills, and localized labels to AgentKit", async () => {
    const onSlashCommand = vi.fn();
    chatMocks.inBuilder = true;
    await mount(baseProps({ onSlashCommand }));

    expect(chatMocks.composerProps.includeDefaultSlashCommands).toBe(true);
    expect(chatMocks.composerProps.includeDefaultSlashSkills).toBe(true);
    expect(
      chatMocks.rootProps.registry.toolSource({
        id: "tool-1",
        name: "provider-api-request",
        input: { provider: "figma" },
        status: "running",
      })?.id,
    ).toBe("figma");
    expect(chatMocks.rootProps.registry.tools).toMatchObject({
      "connect-builder": chatMocks.rootProps.slots.tool,
      "connect-file-storage": chatMocks.rootProps.slots.tool,
    });
    expect(chatMocks.composerProps.onSlashCommand).toBe(onSlashCommand);
    expect(chatMocks.composerProps.interceptBuildRequestsForBuilder).toBe(true);
    expect(chatMocks.rootProps.labels).toMatchObject({
      editMessage: "agentChat.message.edit",
      cancelEditing: "agentChat.common.cancel",
      regenerateResponse: "agentChat.message.regenerate",
      expandMessage: "agentChat.common.expand",
      collapseMessage: "agentChat.common.collapse",
      messageUnavailable: "agentChat.message.unavailable",
      navigationUnavailable: "agentChat.message.navigationUnavailable",
      queueSendNow: "agentChat.queue.sendNow",
      queueSendNowHint: "agentChat.queue.sendNowHint",
      queueSendNext: "agentChat.queue.sendNext",
      queueSendNextHint: "agentChat.queue.sendNextHint",
      previewAttachment: "Preview {{name}}",
      imagePreview: "agentChat.composer.imagePreview",
      closePreview: "agentChat.composer.closePreview",
      dropFilesToAttach: "agentChat.composer.dropToAttach",
      scrollToBottom: "agentChat.composer.scrollToBottom",
      approvalSubmit: "agentChat.approval.submit",
      approvalOther: "agentChat.approval.other",
      approvalOtherPlaceholder: "agentChat.approval.otherPlaceholder",
      connectionConnecting: "agentChat.connection.connecting",
      connectionNotNow: "agentChat.connection.notNow",
      connectionFailed: "agentChat.connection.failed",
      connectionAdminRequired: "agentChat.connection.adminRequired",
      agents: "agentChat.activity.agents",
      tasks: "agentChat.activity.tasks",
      renderError: "agentChat.error.render",
      agentStarted: "agentChat.agent.started",
      agentResumed: "agentChat.agent.resumed",
      agentMessaged: "agentChat.agent.messaged",
      agentDelegated: "agentChat.agent.delegated",
      agentPaused: "agentChat.agent.paused",
      agentCompleted: "agentChat.agent.completed",
      agentFailed: "agentChat.agent.failed",
      agentClosed: "agentChat.agent.closed",
    });
  });

  it("copies markdown replies to the clipboard as rich HTML", async () => {
    await mount(baseProps());

    await expect(
      chatMocks.rootProps.onCopyMessage({ text: "**Ready**", message: {} }),
    ).resolves.toBe(true);
    expect(chatMocks.renderMarkdownToClipboardHtml).toHaveBeenCalledWith(
      "**Ready**",
    );
    expect(chatMocks.writeClipboardText).toHaveBeenCalledWith("**Ready**", {
      html: "<p><strong>Ready</strong></p>",
    });
  });

  it("keeps disabled Plan mode and its reason on the composer", async () => {
    await mount(
      baseProps({
        planModeDisabled: true,
        planModeDisabledReason: "Plan mode is unavailable here.",
      }),
    );

    expect(chatMocks.composerProps).toMatchObject({
      planModeDisabled: true,
      planModeDisabledReason: "Plan mode is unavailable here.",
    });
  });

  it("forwards inline actions through the shared action surface", async () => {
    await mount(baseProps());
    const invokeAction = chatMocks.transportOptions.operations.invokeAction;
    const invocation = {
      id: "action-1",
      action: "slides.update",
      payload: { slideId: "slide-1", title: "Updated" },
    };

    await expect(invokeAction({ invocation })).resolves.toMatchObject({
      invocationId: "action-1",
      status: "completed",
      data: null,
    });
    expect(chatMocks.callAction).toHaveBeenCalledWith("slides.update", {
      slideId: "slide-1",
      title: "Updated",
    });
  });

  it("shows attachment errors beside the composer", async () => {
    await mount(baseProps());

    await act(async () => {
      chatMocks.composerProps.onAttachmentError("Upload was rejected.");
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Upload was rejected.",
    );
  });

  it("keeps hidden messages and internal context out of the transcript", async () => {
    await mount(baseProps());
    const Message = chatMocks.rootProps.slots.message;

    await act(async () => {
      root.render(
        <Message
          threadId={chatMocks.threadId}
          value={{
            id: "hidden",
            role: "user",
            createdAt: new Date().toISOString(),
            parts: [{ type: "text", text: "Internal recovery prompt" }],
            metadata: { hideUserMessage: true },
          }}
        />,
      );
    });
    expect(container.textContent).toBe("");

    const message = appendAgentChatContextToMessage(
      "Visible request",
      "Selected rows: a, b",
    );
    await act(async () => {
      root.render(
        <Message
          threadId={chatMocks.threadId}
          value={{
            id: "visible",
            role: "user",
            createdAt: new Date().toISOString(),
            parts: [{ type: "text", text: message }],
          }}
        />,
      );
    });
    expect(container.textContent).toContain("Visible request");
    expect(container.textContent).not.toContain("Selected rows: a, b");
  });

  it("restores saved integration prompts through the same queue path", async () => {
    chatMocks.thread.activeRunIds = ["run-1"];
    await mount(baseProps());

    const resume = chatMocks.resumeProps.onMessageResume({
      message: "Continue after connecting the integration.",
    });
    expect(resume).toBeInstanceOf(Promise);
    await act(async () => resume);
    expect(chatMocks.control.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Continue after connecting the integration.",
        queuedWhileRunActive: true,
      }),
    );

    await act(async () => {
      await chatMocks.resumeProps.onResume(
        { threadId: chatMocks.threadId, runId: "run-1", requestId: "req-1" },
        { message: "Restore the saved tool request." },
      );
    });
    expect(chatMocks.control.resolveConnectionRequest).toHaveBeenCalledWith(
      "run-1",
      "req-1",
      {
        status: "connected",
        message: "Restore the saved tool request.",
      },
    );
  });

  it("resumes a generic saved prompt once through the active submission queue", async () => {
    chatMocks.thread.activeRunIds = ["run-1"];
    await mount(baseProps());

    await act(async () => {
      await chatMocks.resumeProps.onMessageResume({
        message: "Continue after OAuth.",
      });
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(chatMocks.control.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Continue after OAuth.",
        queuedWhileRunActive: true,
      }),
    );
    expect(chatMocks.control.queueMessage).not.toHaveBeenCalled();
  });

  it("keeps failed integration prompt submissions resumable", async () => {
    chatMocks.thread.activeRunIds = ["run-1"];
    const submissionError = new Error("Temporary send failure");
    chatMocks.control.sendMessage.mockRejectedValueOnce(submissionError);
    await mount(baseProps());

    await expect(
      chatMocks.resumeProps.onMessageResume({
        message: "Continue after OAuth.",
      }),
    ).rejects.toBe(submissionError);
  });

  it("shows the missing-final-response warning from recovered run metadata", async () => {
    chatMocks.thread.messages = [
      {
        id: "assistant-warning",
        role: "assistant",
        status: "complete",
        createdAt: new Date().toISOString(),
        parts: [{ type: "text", text: "The tool completed." }],
        metadata: {
          custom: {
            runWarning: {
              errorCode: "final_response_missing_after_tool",
            },
          },
        },
      },
    ];
    await mount(baseProps());

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "agentChat.message.missingFinal",
    );
  });

  it("shows the localized stopped state for a completed tool-loop stop", async () => {
    chatMocks.thread.messages = [
      {
        id: "assistant-loop-stop",
        role: "assistant",
        status: "complete",
        createdAt: new Date().toISOString(),
        parts: [{ type: "text", text: "The deck is complete." }],
        metadata: {
          custom: {
            runWarning: {
              errorCode: "tool_loop_stopped",
              message: "Stopped after repeated layout checks.",
            },
          },
        },
      },
    ];
    await mount(baseProps());

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "agentChat.error.stopped",
    );
    expect(
      container.querySelector('[role="status"]')?.textContent,
    ).not.toContain("Stopped after repeated layout checks.");
  });

  it("restores a thread with a loading state, a 404 state, and retry", async () => {
    const onThreadRestoreNotFound = vi.fn();
    await mount(baseProps({ isNewThread: false, onThreadRestoreNotFound }));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => {
      chatMocks.rootProps.onLoadError({ status: 404 });
      await Promise.resolve();
    });
    expect(onThreadRestoreNotFound).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("agentChat.message.threadNotFound");

    await act(async () => {
      chatMocks.rootProps.onLoadError({ status: 404 });
      await Promise.resolve();
    });
    expect(onThreadRestoreNotFound).toHaveBeenCalledOnce();

    const retryButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "agentChat.common.retry",
    );
    expect(retryButton).toBeDefined();
    await act(async () => retryButton?.click());
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("routes the built-in transport 404 through AgentKitRoot to the not-found fallback", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    const onThreadRestoreNotFound = vi.fn();
    const runtime = {
      id: "restore-test",
      kind: "agent-native",
      label: "Restore test",
      capabilities: { messages: { streaming: false } },
      createSession: vi.fn(),
    } as any;
    chatMocks.createTransport.mockImplementation((options: any) =>
      createAgentNativeAgentKitTransport({ ...options, runtime, fetch }),
    );
    chatMocks.useRealRoot = true;

    await mount(
      baseProps({
        threadId: "missing-thread",
        isNewThread: false,
        onThreadRestoreNotFound,
      }),
    );
    await flush();
    expect(fetch).toHaveBeenCalledOnce();

    expect(onThreadRestoreNotFound).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("agentChat.message.threadNotFound");
  });

  it("hands a recent snapshot across surfaces while thread persistence lags", async () => {
    const threadId = "surface-handoff-thread";
    const browserTabId = "surface-handoff-tab";
    const savedSnapshots = vi.fn();
    const message = {
      id: "handoff-user-message",
      role: "user",
      status: "complete",
      createdAt: "2026-09-26T12:00:00.000Z",
      parts: [{ type: "text", text: "Keep this transcript visible" }],
    };
    const assistantMessage = {
      id: "handoff-assistant-message",
      role: "assistant",
      status: "complete",
      createdAt: "2026-09-26T12:00:01.000Z",
      parts: [{ type: "text", text: "Assistant answer survives handoff" }],
    };
    const followupUserMessage = {
      id: "handoff-followup-user-message",
      role: "user",
      status: "complete",
      createdAt: "2026-09-26T12:00:02.000Z",
      parts: [{ type: "text", text: "Save after handoff" }],
    };
    chatMocks.threadId = threadId;
    chatMocks.thread = {
      thread: {
        id: threadId,
        title: "",
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      },
      messages: [message, assistantMessage],
      events: [],
      activeRunIds: [],
      runs: {},
      tools: {},
      activities: {},
      queuedMessages: [],
      tasks: {},
      taskGroups: {},
      approvals: {},
      approvalRunIds: {},
      connectionRequests: {},
      connectionRequestRunIds: {},
      widgets: {},
      widgetMessageIds: {},
      annotations: {},
      annotationMessageIds: {},
      agents: {},
      agentInteractions: [],
      artifacts: [],
      suggestions: [],
    };
    await mount(
      baseProps({
        threadId,
        browserTabId,
        isNewThread: false,
        onSaveThread: savedSnapshots,
      }),
    );

    await act(async () => root.render(null));
    expect(savedSnapshots).toHaveBeenCalledOnce();
    expect(savedSnapshots).toHaveBeenCalledWith(
      threadId,
      expect.objectContaining({
        title: "Keep this transcript visible",
        titleSource: "fallback",
      }),
    );
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    const runtime = {
      id: "handoff-test",
      kind: "agent-native",
      label: "Handoff test",
      capabilities: { messages: { streaming: false } },
      createSession: vi.fn(),
    } as any;
    chatMocks.thread = {
      thread: null,
      messages: [],
      events: [],
      activeRunIds: [],
      runs: {},
      tools: {},
      activities: {},
      queuedMessages: [],
      tasks: {},
      taskGroups: {},
      approvals: {},
      approvalRunIds: {},
      connectionRequests: {},
      connectionRequestRunIds: {},
      widgets: {},
      widgetMessageIds: {},
      annotations: {},
      annotationMessageIds: {},
      agents: {},
      agentInteractions: [],
      artifacts: [],
      suggestions: [],
    };
    chatMocks.createTransport.mockImplementation((options: any) =>
      createAgentNativeAgentKitTransport({ ...options, runtime, fetch }),
    );
    const restoredProps = baseProps({
      threadId,
      browserTabId,
      isNewThread: false,
      onSaveThread: savedSnapshots,
      centerComposerWhenEmpty: true,
      suggestionPlacement: "context-chips",
      homeIntroSlot: <h1>What should we do?</h1>,
      afterComposerSlot: <div data-testid="home-app-grid" />,
      suggestions: ["Explore my apps"],
    });
    const restoredRef = createRef<any>();
    await act(async () =>
      root.render(
        <AgentKitAssistantChat {...restoredProps} ref={restoredRef} />,
      ),
    );

    expect(container.textContent).toContain("Keep this transcript visible");
    expect(container.textContent).toContain(
      "Assistant answer survives handoff",
    );
    expect(container.querySelector(".agentkit-home-intro")).toBeNull();
    expect(container.querySelector(".agentkit-home-suggestions")).toBeNull();
    expect(container.querySelector(".agentkit-after-composer-slot")).toBeNull();
    expect(chatMocks.chatProps.hasRenderedMessages).toBe(true);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    const handoff = await chatMocks.rootProps.transport.getThreadSnapshot({
      threadId,
    });
    expect(handoff).toMatchObject({
      title: "Keep this transcript visible",
      titleSource: "fallback",
    });
    expect(handoff.messages[0].parts).toContainEqual({
      type: "text",
      text: "Keep this transcript visible",
    });
    expect(handoff.messages[1].parts).toContainEqual({
      type: "text",
      text: "Assistant answer survives handoff",
    });
    expect(fetch).not.toHaveBeenCalled();

    chatMocks.thread = {
      ...chatMocks.thread,
      thread: handoff,
      messages: [...handoff.messages, followupUserMessage],
    };
    await act(async () =>
      root.render(
        <AgentKitAssistantChat {...restoredProps} ref={restoredRef} />,
      ),
    );
    const restoredSurfaceSnapshot = restoredRef.current?.exportThreadSnapshot();
    expect(restoredSurfaceSnapshot).toMatchObject({
      title: "Keep this transcript visible",
      titleSource: "fallback",
    });
  });

  it("keeps transient thread-restore errors retryable without clearing the tab", async () => {
    const onThreadRestoreNotFound = vi.fn();
    await mount(baseProps({ isNewThread: false, onThreadRestoreNotFound }));

    await act(async () => {
      chatMocks.rootProps.onLoadError({ status: 503 });
      await Promise.resolve();
    });

    expect(onThreadRestoreNotFound).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "agentChat.message.restoreRequestFailed",
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "agentChat.common.retry",
      ),
    ).toBe(true);
  });

  it("focuses the composer only after an explicit prefill revision", async () => {
    const ref = createRef<AssistantChatHandle>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<AgentKitAssistantChat ref={ref} {...baseProps()} />);
    });
    expect(chatMocks.requestComposerFocus).not.toHaveBeenCalled();

    await act(async () => ref.current?.prefillMessage("Draft this"));

    expect(chatMocks.requestComposerFocus).toHaveBeenCalledOnce();
    expect(chatMocks.requestComposerFocus).toHaveBeenCalledWith("thread-1");
  });

  it("keeps Continue hidden as a protocol continuation", async () => {
    const referenceUrl = "https://files.example.test/reference.png";
    chatMocks.thread.messages = [
      {
        id: "user-continue",
        role: "user",
        createdAt: new Date().toISOString(),
        parts: [
          { type: "text", text: "Design from this reference" },
          {
            type: "file",
            name: "reference.png",
            mediaType: "image/png",
            url: referenceUrl,
          },
        ],
        metadata: {
          custom: {
            agentNativeRetryRequestAttachments: [
              {
                type: "image",
                name: "reference.png",
                contentType: "image/png",
                url: referenceUrl,
                referenceUrl,
              },
            ],
          },
        },
      },
    ];
    await mount(baseProps());

    await act(async () => {
      chatMocks.failureProps.onContinue();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
    expect(request.text).toBe(
      "Continue from where you left off and finish my last request. Do not repeat completed work.",
    );
    expect(request.metadata).toMatchObject({
      hideUserMessage: true,
      agentNativeInternalContinuation: true,
      custom: { agentNativeRecoveryAction: "continue" },
    });
    expect(request.attachments).toContainEqual({
      type: "file",
      name: "reference.png",
      mediaType: "image/png",
      url: referenceUrl,
    });
    expect(request.requestAttachments).toContainEqual({
      type: "image",
      name: "reference.png",
      contentType: "image/png",
      url: referenceUrl,
      referenceUrl,
    });
  });

  it.each([
    {
      name: "a missing durable reference",
      filePart: {
        type: "file",
        name: "reference.png",
        mediaType: "image/png",
      },
    },
    {
      name: "an inline data URL",
      filePart: {
        type: "file",
        name: "reference.png",
        mediaType: "image/png",
        url: "data:image/png;base64,aW5saW5l",
      },
    },
  ])("does not continue with $name", async ({ filePart }) => {
    chatMocks.thread.messages = [
      {
        id: "user-continue-with-invalid-file",
        role: "user",
        parts: [
          { type: "text", text: "Continue using this reference" },
          filePart,
        ],
      },
    ];
    await mount(baseProps());

    expect(chatMocks.failureProps.retryHasUnavailableAttachment).toBe(true);
    await act(async () => {
      chatMocks.failureProps.onContinue();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(chatMocks.failureProps.continueError).toBe(
      "agentChat.recovery.continueUnavailable",
    );
  });

  it("shows an error when protocol Continue rejects", async () => {
    chatMocks.control.sendMessage.mockRejectedValueOnce(
      new Error("transport unavailable"),
    );
    await mount(baseProps());

    await act(async () => {
      chatMocks.failureProps.onContinue();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(chatMocks.failureProps.continueError).toBe(
      "agentChat.recovery.continueUnavailable",
    );
  });

  it("replays attachments and run identity when the stuck banner continues", async () => {
    const referenceUrl = "https://files.example.test/stuck-reference.png";
    chatMocks.thread.messages = [
      {
        id: "user-stuck-continue",
        role: "user",
        createdAt: new Date().toISOString(),
        parts: [
          { type: "text", text: "Design from this reference" },
          {
            type: "file",
            name: "stuck-reference.png",
            mediaType: "image/png",
            url: referenceUrl,
          },
        ],
        metadata: {
          custom: {
            agentNativeRetryRequestAttachments: [
              {
                type: "image",
                name: "stuck-reference.png",
                contentType: "image/png",
                url: referenceUrl,
                referenceUrl,
              },
            ],
          },
        },
      },
    ];
    await mount(baseProps());

    await act(async () => {
      chatMocks.stuckBannerProps.onRetry("stuck-run-1");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
    expect(request.attachments).toContainEqual({
      type: "file",
      name: "stuck-reference.png",
      mediaType: "image/png",
      url: referenceUrl,
    });
    expect(request.requestAttachments).toContainEqual({
      type: "image",
      name: "stuck-reference.png",
      contentType: "image/png",
      url: referenceUrl,
      referenceUrl,
    });
    expect(request.metadata.custom).toMatchObject({
      agentNativeRecoveryAction: "continue",
      agentNativeRecoveryOfRunId: "stuck-run-1",
    });
  });

  it("shows an error when the stuck-banner Continue rejects", async () => {
    chatMocks.control.sendMessage.mockRejectedValueOnce(
      new Error("transport unavailable"),
    );
    await mount(baseProps());

    await act(async () => {
      chatMocks.stuckBannerProps.onRetry("stuck-run-1");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "agentChat.recovery.continueUnavailable",
    );
  });

  it("shows an error when loop-limit Continue rejects", async () => {
    chatMocks.failureError = { code: "loop_limit", message: "Limit reached" };
    chatMocks.control.sendMessage.mockRejectedValueOnce(
      new Error("transport unavailable"),
    );
    await mount(baseProps());

    await act(async () => {
      chatMocks.loopLimitProps.onContinue();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "agentChat.recovery.continueUnavailable",
    );
  });

  it("shows a visible error when retrying without an attachment fails", async () => {
    chatMocks.failureError = {
      code: "invalid_attachment",
      message: "The provider rejected this attachment.",
    };
    chatMocks.thread.messages = [
      {
        id: "user-invalid-attachment",
        role: "user",
        parts: [
          { type: "text", text: "Use this reference" },
          {
            type: "file",
            name: "reference.png",
            mediaType: "image/png",
            url: "https://files.example.test/reference.png",
          },
        ],
      },
    ];
    chatMocks.control.sendMessage.mockRejectedValueOnce(
      new Error("transport unavailable"),
    );
    await mount(baseProps());

    await act(async () => {
      chatMocks.failureProps.onRetryWithoutAttachment();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "agentChat.recovery.deferredSubmissionFailed",
    );
  });

  it("strips appended context from Retry and preserves request metadata", async () => {
    const requestText = appendAgentChatContextToMessage(
      "Retry the export",
      "Private selected rows",
    );
    const reference = { id: "reference-1", type: "document" };
    chatMocks.thread.messages = [
      {
        id: "user-retry",
        role: "user",
        createdAt: new Date().toISOString(),
        parts: [
          { type: "text", text: requestText },
          {
            type: "file",
            name: "source.csv",
            mediaType: "text/csv",
            url: "https://files.example.test/source.csv",
          },
        ],
        metadata: {
          model: "model-original",
          engine: "engine-original",
          effort: "high",
          requestMode: "plan",
          references: [reference],
        },
      },
    ];
    await mount(baseProps({ execMode: "build" }));

    await act(async () => {
      chatMocks.failureProps.onRetry();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
    expect(request.text).toBe("Retry the export");
    expect(request.text).not.toContain("Private selected rows");
    expect(request.attachments).toEqual([
      {
        type: "file",
        name: "source.csv",
        mediaType: "text/csv",
        url: "https://files.example.test/source.csv",
      },
    ]);
    expect(request.metadata).toMatchObject({
      hideUserMessage: true,
      model: "model-original",
      engine: "engine-original",
      effort: "high",
      requestMode: "plan",
      references: [reference],
      custom: { agentNativeRecoveryAction: "retry" },
    });
    expect(request.options).toMatchObject({
      model: "model-original",
      mode: "plan",
      reasoningEffort: "high",
    });
  });

  it("retries a rejected attachment's request with its text and context only", async () => {
    const requestText = appendAgentChatContextToMessage(
      "Make a LinkedIn ad 1200x627",
      "Selected brand kit",
    );
    chatMocks.failureError = {
      code: "invalid_attachment",
      message: "The provider rejected this attachment.",
      retryable: false,
    };
    chatMocks.thread.messages = [
      {
        id: "user-attachment",
        role: "user",
        createdAt: new Date().toISOString(),
        parts: [
          { type: "text", text: requestText },
          {
            type: "file",
            name: "huge.tiff",
            mediaType: "image/tiff",
            url: "https://files.example.test/huge.tiff",
          },
        ],
        metadata: { model: "model-original", requestMode: "act" },
      },
    ];
    await mount(baseProps());

    expect(chatMocks.failureProps.info).toMatchObject({
      errorCode: "invalid_attachment",
    });
    await act(async () => {
      chatMocks.failureProps.onRetryWithoutAttachments();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
    expect(request.text).toBe(requestText);
    expect(request.attachments).toEqual([]);
    expect(request.requestAttachments).toBeUndefined();
    expect(request.metadata).toMatchObject({
      model: "model-original",
      custom: {
        agentNativeRecoveryAction: "retry",
        agentNativeRecoveryOfRunId: "run-1",
      },
    });
  });

  it("offers no attachment-free retry when the failed request had no attachments", async () => {
    chatMocks.failureError = {
      code: "invalid_attachment",
      message: "The provider rejected this attachment.",
      retryable: false,
    };
    chatMocks.thread.messages = [
      {
        id: "user-text",
        role: "user",
        parts: [{ type: "text", text: "Just text" }],
      },
    ];
    await mount(baseProps());

    expect(chatMocks.failureProps.onRetryWithoutAttachments).toBeUndefined();
  });

  it("reuses file IDs when retrying a saved request", async () => {
    chatMocks.thread.messages = [
      {
        id: "user-retry",
        role: "user",
        parts: [
          { type: "text", text: "Retry the export" },
          {
            type: "file",
            name: "source.csv",
            mediaType: "text/csv",
            fileId: "file-1",
          },
        ],
      },
    ];
    await mount(baseProps());

    expect(chatMocks.failureProps.retryHasUnavailableAttachment).toBe(false);
    await act(async () => {
      chatMocks.failureProps.onRetry();
      await Promise.resolve();
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    expect(
      chatMocks.control.sendMessage.mock.calls[0]?.[0].attachments,
    ).toEqual([
      {
        type: "file",
        name: "source.csv",
        mediaType: "text/csv",
        fileId: "file-1",
      },
    ]);
    expect(chatMocks.control.uploadFiles).not.toHaveBeenCalled();
  });

  it("resends the resized vision image from its durable URL when retrying", async () => {
    const originalUrl = "https://files.example.test/reference.png";
    const resizedAttachment = {
      type: "image" as const,
      name: "reference.png",
      contentType: "image/jpeg",
      url: "https://files.example.test/reference-resized.jpg",
      referenceUrl: originalUrl,
    };
    chatMocks.thread.messages = [
      {
        id: "user-retry-image",
        role: "user",
        parts: [
          { type: "text", text: "Use this reference" },
          {
            type: "file",
            name: "reference.png",
            mediaType: "image/png",
            url: originalUrl,
          },
        ],
        metadata: {
          custom: {
            agentNativeRetryRequestAttachments: [resizedAttachment],
          },
        },
      },
    ];
    await mount(baseProps());

    expect(chatMocks.failureProps.retryHasUnavailableAttachment).toBe(false);
    await act(async () => {
      chatMocks.failureProps.onRetry();
      await Promise.resolve();
    });

    const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
    expect(request.attachments).toEqual([
      {
        type: "file",
        name: "reference.png",
        mediaType: "image/png",
        url: originalUrl,
      },
    ]);
    expect(request.requestAttachments).toEqual([resizedAttachment]);
    expect(request.requestAttachments[0]?.data).toBeUndefined();
  });

  it("shows a named invalid-attachment error and retries the original request without files", async () => {
    const reference = { id: "reference-1", type: "document" };
    chatMocks.failureError = {
      code: "invalid_attachment",
      message: "The provider rejected this image.",
    };
    chatMocks.thread.messages = [
      {
        id: "user-invalid-attachment",
        role: "user",
        parts: [
          {
            type: "text",
            text: appendAgentChatContextToMessage(
              "Use this reference",
              "Private selected rows",
            ),
          },
          {
            type: "file",
            name: "reference.png",
            mediaType: "image/png",
            url: "https://files.example.test/reference.png",
          },
        ],
        metadata: {
          model: "model-original",
          engine: "engine-original",
          effort: "high",
          requestMode: "plan",
          references: [reference],
          custom: {
            agentNativeRetryRequestAttachments: [
              {
                type: "image",
                name: "reference.png",
                contentType: "image/jpeg",
                url: "https://files.example.test/reference-resized.jpg",
                referenceUrl: "https://files.example.test/reference.png",
              },
            ],
          },
        },
      },
    ];
    await mount(baseProps({ execMode: "build" }));

    expect(chatMocks.failureProps.info.message).toBe(
      "agentChat.errorMessages.invalidAttachmentNamed:reference.png",
    );
    expect(chatMocks.failureProps.onRetryWithoutAttachment).toEqual(
      expect.any(Function),
    );

    await act(async () => {
      chatMocks.failureProps.onRetryWithoutAttachment();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
    expect(request.text).toBe("Use this reference");
    expect(request.attachments).toEqual([]);
    expect(request.requestAttachments).toBeUndefined();
    expect(request.metadata).toMatchObject({
      hideUserMessage: true,
      model: "model-original",
      engine: "engine-original",
      effort: "high",
      requestMode: "plan",
      references: [reference],
      custom: {
        agentNativeRecoveryAction: "retry",
        agentNativeRecoveryOfRunId: "run-1",
      },
    });
    expect(request.options).toMatchObject({
      model: "model-original",
      mode: "plan",
      reasoningEffort: "high",
    });
  });

  it("does not offer attachment-free retry for errors without attachments", async () => {
    chatMocks.failureError = {
      code: "invalid_attachment",
      message: "The provider rejected an attachment.",
    };
    await mount(baseProps());

    expect(chatMocks.failureProps.onRetryWithoutAttachment).toBeUndefined();
  });

  it("disables retry when a resized image has no durable vision reference", async () => {
    chatMocks.thread.messages = [
      {
        id: "user-retry-image",
        role: "user",
        parts: [
          { type: "text", text: "Use this reference" },
          {
            type: "file",
            name: "reference.png",
            mediaType: "image/png",
            url: "https://files.example.test/reference.png",
          },
        ],
        metadata: {
          custom: { agentNativeRetryAttachmentsUnavailable: true },
        },
      },
    ];
    await mount(baseProps());

    expect(chatMocks.failureProps.retryHasUnavailableAttachment).toBe(true);
  });

  it("keeps saved file IDs when retrying while the provider is unavailable", async () => {
    chatMocks.readiness = {
      canChat: false,
      missing: false,
      state: "unavailable",
    };
    chatMocks.fileUploadStatus = {
      data: { configured: false },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };
    chatMocks.thread.messages = [
      {
        id: "user-retry",
        role: "user",
        parts: [
          { type: "text", text: "Retry the export" },
          {
            type: "file",
            name: "source.csv",
            mediaType: "text/csv",
            fileId: "file-1",
          },
        ],
      },
    ];
    await mount(baseProps({}));

    await act(async () => {
      chatMocks.failureProps.onRetry();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(chatMocks.thread.messages[0]?.parts).toContainEqual({
      type: "file",
      name: "source.csv",
      mediaType: "text/csv",
      fileId: "file-1",
    });
    expect(
      [...chatMocks.appState.keys()].some((key) =>
        key.startsWith("agentkit-deferred-provider-submissions:"),
      ),
    ).toBe(false);
    expect(chatMocks.control.uploadFiles).not.toHaveBeenCalled();
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("shows the optimistic queue entry while AI setup is pending and rolls it back on refusal", async () => {
    const setup = Promise.withResolvers<void>();
    chatMocks.control.queueMessage.mockImplementation(async (input: any) => {
      const optimistic = {
        id: "queued-pending-setup",
        threadId: chatMocks.threadId,
        text: input.text,
        createdAt: "2026-10-09T00:00:00.000Z",
      };
      chatMocks.thread = {
        ...chatMocks.thread,
        queuedMessages: [...chatMocks.thread.queuedMessages, optimistic],
      };
      try {
        await setup.promise;
        return optimistic;
      } catch (error) {
        chatMocks.thread = {
          ...chatMocks.thread,
          queuedMessages: chatMocks.thread.queuedMessages.filter(
            (message: any) => message.id !== optimistic.id,
          ),
        };
        throw error;
      }
    });
    const ref = createRef<AssistantChatHandle>();
    await mount(baseProps(), ref);

    let submission:
      | Promise<Awaited<ReturnType<AssistantChatHandle["queueMessage"]>>>
      | undefined;
    await act(async () => {
      submission = ref.current?.queueMessage("Send this after setup");
      await Promise.resolve();
    });
    expect(chatMocks.control.queueMessage).toHaveBeenCalledOnce();
    expect(chatMocks.thread.queuedMessages).toEqual([
      expect.objectContaining({
        text: "Send this after setup",
        id: "queued-pending-setup",
      }),
    ]);

    setup.reject(
      Object.assign(new Error("AI setup is required before sending."), {
        code: "AGENT_CHAT_AI_SETUP_REQUIRED",
        state: "missing",
      }),
    );
    let result:
      | Awaited<ReturnType<AssistantChatHandle["queueMessage"]>>
      | undefined;
    await act(async () => {
      result = await submission;
    });

    expect(result).toEqual({
      status: "rejected",
      reason: "engine-not-configured",
    });
    expect(chatMocks.thread.queuedMessages).toEqual([]);
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("marks a saved file without a replay reference as unavailable", async () => {
    chatMocks.thread.messages = [
      {
        id: "user-retry",
        role: "user",
        parts: [
          { type: "text", text: "Retry the export" },
          { type: "file", name: "source.csv", mediaType: "text/csv" },
        ],
      },
    ];
    await mount(baseProps());

    expect(chatMocks.failureProps.retryHasUnavailableAttachment).toBe(true);
  });

  it("shows a localized Stop tooltip and bounces the blocked setup card", async () => {
    chatMocks.readiness = {
      canChat: false,
      missing: true,
      state: "missing",
    };
    chatMocks.thread.activeRunIds = ["run-1"];
    const blockedEvents: CustomEvent[] = [];
    const onBlocked = (event: Event) =>
      blockedEvents.push(event as CustomEvent);
    window.addEventListener("agent-chat:missing-api-key", onBlocked);
    await mount(baseProps({}));

    expect(
      container
        .querySelector(".agentkit-host-composer")
        ?.classList.contains("agent-composer-area--attached-above"),
    ).toBe(true);
    expect(chatMocks.setupCardProps.onRetry).toBeUndefined();
    const stopButton = chatMocks.composerProps.stopButton as React.ReactElement;
    expect(stopButton.props).toMatchObject({
      "aria-label": "agentChat.composer.stopResponse",
      title: "agentChat.composer.stopResponse",
    });
    expect(chatMocks.setupCardProps.bouncePulse).toBe(0);

    await act(async () => chatMocks.composerProps.onDisabledClick());

    expect(chatMocks.setupCardProps.bouncePulse).toBeGreaterThan(0);
    expect(blockedEvents).toHaveLength(1);
    window.removeEventListener("agent-chat:missing-api-key", onBlocked);
  });

  it("masks a connection failure message without masking recovery controls", async () => {
    chatMocks.connectionError = {
      code: "runtime_error",
      message: "Example Person's example document is locked.",
      retryable: true,
    };
    await mount(baseProps());
    const message = Array.from(container.querySelectorAll("span")).find(
      (element) =>
        element.textContent === `Error: ${chatMocks.connectionError.message}`,
    );
    expect(message?.hasAttribute("data-an-mask")).toBe(true);
    expect(
      message?.closest('[role="alert"]')?.hasAttribute("data-an-mask"),
    ).toBe(false);
    expect(
      message
        ?.closest('[role="alert"]')
        ?.querySelector("button")
        ?.closest("[data-an-mask]"),
    ).toBeNull();
  });

  it("shows one standard inline setup card without raw provider error text", async () => {
    chatMocks.readiness = {
      canChat: false,
      missing: true,
      state: "missing",
    };
    chatMocks.failureError = {
      code: "missing_credentials",
      message:
        "No LLM provider is connected. Open Settings > Agent > AI providers.",
    };

    await mount(baseProps({ showMissingApiKeySetup: false }));

    expect(
      container.querySelectorAll('[data-testid="builder-setup-card"]'),
    ).toHaveLength(1);
    expect(
      chatMocks.setupCardPropsHistory.some(
        (props: any) => props.attached !== true && props.layout === "default",
      ),
    ).toBe(true);
    expect(container.textContent).not.toContain("No LLM provider is connected");
    expect(container.textContent).not.toContain("Open Settings > Agent");
  });

  it("shows one credit-limit recovery card for the latest failed run", async () => {
    chatMocks.failureError = {
      code: "credits-limit-daily",
      message: "You've reached your AI credits limit.",
    };
    chatMocks.failureCopies = 2;
    chatMocks.failureRunIds = ["run-1", "run-2"];
    chatMocks.thread.runs = {
      "run-1": {
        id: "run-1",
        status: "failed",
        startedAt: "2026-10-01T00:00:00.000Z",
        error: { code: "credits-limit-daily", message: "limit reached" },
      },
      "run-2": {
        id: "run-2",
        status: "failed",
        startedAt: "2026-10-01T00:01:00.000Z",
        error: { code: "credits-limit-daily", message: "limit reached" },
      },
    };

    await mount(baseProps());

    expect(
      container.querySelectorAll('[data-testid="run-error-recovery-card"]'),
    ).toHaveLength(1);
    expect(chatMocks.failureProps.info.errorCode).toBe("credits-limit-daily");
  });

  it("deduplicates credit-limit cards when failed runs share a timestamp", async () => {
    chatMocks.failureError = {
      code: "credits-limit-daily",
      message: "You've reached your AI credits limit.",
    };
    chatMocks.failureCopies = 2;
    chatMocks.failureRunIds = ["run-1", "run-2"];
    chatMocks.thread.runs = {
      "run-1": {
        id: "run-1",
        status: "failed",
        startedAt: "2026-10-01T00:00:00.000Z",
        error: { code: "credits-limit-daily", message: "limit reached" },
      },
      "run-2": {
        id: "run-2",
        status: "failed",
        startedAt: "2026-10-01T00:00:00.000Z",
        error: { code: "credits-limit-daily", message: "limit reached" },
      },
    };

    await mount(baseProps());

    expect(
      container.querySelectorAll('[data-testid="run-error-recovery-card"]'),
    ).toHaveLength(1);
  });

  it("answers a refused prompt in the thread when the host hides the composer setup card", async () => {
    chatMocks.readiness = {
      canChat: false,
      missing: true,
      state: "missing",
    };
    chatMocks.failureError = {
      code: "AGENT_CHAT_AI_SETUP_REQUIRED",
      message: "Use Builder.io or a provider API key before chatting.",
    };

    await mount(
      baseProps({
        showMissingApiKeySetup: false,
      }),
    );

    expect(
      container.querySelectorAll('[data-testid="builder-setup-card"]'),
    ).toHaveLength(1);
    expect(chatMocks.setupCardProps.onRetry).toEqual(expect.any(Function));
  });

  it("sends a prompt refused for missing AI setup again, once, after setup becomes ready", async () => {
    chatMocks.readiness = { canChat: false, missing: true, state: "missing" };
    chatMocks.failureError = {
      code: "missing_credentials",
      message: "No LLM provider is connected.",
    };
    chatMocks.thread.messages = [
      {
        id: "user-refused",
        role: "user",
        createdAt: new Date().toISOString(),
        parts: [{ type: "text", text: "Create a pitch deck" }],
      },
    ];
    chatMocks.thread.runs = {
      "run-1": {
        id: "run-1",
        status: "failed",
        startedAt: "2026-10-01T00:00:00.000Z",
      },
    };
    const props = baseProps({});
    await mount(props);
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();

    chatMocks.readiness = {
      canChat: true,
      missing: false,
      state: "configured",
    };
    await act(async () => root.render(<AgentKitAssistantChat {...props} />));
    await flush();
    await act(async () => root.render(<AgentKitAssistantChat {...props} />));
    await flush();

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
    expect(request.text).toBe("Create a pitch deck");
    expect(request.metadata).toMatchObject({
      hideUserMessage: true,
      custom: {
        agentNativeRecoveryAction: "retry",
        agentNativeRecoveryOfRunId: "run-1",
      },
    });
  });

  it("does not replay a refused prompt when the thread reopens already connected", async () => {
    chatMocks.readiness = { canChat: false, missing: false, state: "unknown" };
    chatMocks.failureError = {
      code: "missing_credentials",
      message: "No LLM provider is connected.",
    };
    chatMocks.thread.messages = [
      {
        id: "user-refused",
        role: "user",
        parts: [{ type: "text", text: "Old prompt" }],
      },
    ];
    const props = baseProps({});
    await mount(props);

    chatMocks.readiness = {
      canChat: true,
      missing: false,
      state: "configured",
    };
    await act(async () => root.render(<AgentKitAssistantChat {...props} />));
    await flush();

    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(chatMocks.setupCardProps.onRetry).toEqual(expect.any(Function));
  });

  const failedThenLaterRun = {
    "run-1": {
      id: "run-1",
      status: "failed",
      startedAt: "2026-10-01T00:00:00.000Z",
    },
    "run-2": {
      id: "run-2",
      status: "completed",
      startedAt: "2026-10-01T00:01:00.000Z",
    },
  };

  it("keeps an ordinary failure with Retry when a different run is retried", async () => {
    chatMocks.failureError = { code: "test-error", message: "Run failed" };
    chatMocks.thread.runs = failedThenLaterRun;
    chatMocks.thread.messages = [
      {
        id: "user-retry",
        role: "user",
        parts: [{ type: "text", text: "Later prompt" }],
        metadata: { custom: { agentNativeRecoveryOfRunId: "run-2" } },
      },
    ];

    await mount(baseProps());

    expect(chatMocks.failureProps.onRetry).toEqual(expect.any(Function));
  });

  it("hides an ordinary failure once a persisted retry answers its run", async () => {
    chatMocks.failureError = { code: "test-error", message: "Run failed" };
    chatMocks.thread.runs = failedThenLaterRun;
    chatMocks.thread.messages = [
      {
        id: "user-retry",
        role: "user",
        parts: [{ type: "text", text: "Original prompt" }],
        metadata: { custom: { agentNativeRecoveryOfRunId: "run-1" } },
      },
    ];

    await mount(baseProps());

    expect(chatMocks.failureProps).toBeNull();
  });

  it("hides an AI-setup refusal once a later run supersedes it", async () => {
    chatMocks.failureError = {
      code: "missing_credentials",
      message: "No LLM provider is connected.",
    };
    chatMocks.thread.runs = failedThenLaterRun;

    await mount(baseProps());

    expect(
      container.querySelectorAll('[data-testid="builder-setup-card"]'),
    ).toHaveLength(0);
  });

  describe("prompt refused for missing AI setup", () => {
    const reference = { id: "reference-1", type: "document" };
    const refusedMessage = {
      id: "user-refused",
      role: "user",
      status: "error",
      createdAt: new Date().toISOString(),
      parts: [
        { type: "text", text: "Create a pitch deck" },
        {
          type: "file",
          name: "brief.pdf",
          mediaType: "application/pdf",
          url: "https://files.example.test/brief.pdf",
        },
      ],
      metadata: {
        model: "model-original",
        engine: "engine-original",
        effort: "high",
        requestMode: "plan",
        references: [reference],
      },
    };

    async function connectAi(props: AgentKitAssistantChatProps) {
      chatMocks.readiness = {
        canChat: true,
        missing: false,
        state: "configured",
      };
      await act(async () => root.render(<AgentKitAssistantChat {...props} />));
      await flush();
      await act(async () => root.render(<AgentKitAssistantChat {...props} />));
      await flush();
    }

    function refuse(error: { code: string; message: string }) {
      chatMocks.readiness = { canChat: false, missing: true, state: "missing" };
      chatMocks.thread.messages = [refusedMessage];
      chatMocks.thread.runs = {
        "run-1": {
          id: "run-1",
          status: "failed",
          startedAt: "2026-10-01T00:00:00.000Z",
        },
      };
      return error;
    }

    it("sends once when two cards show the same refusal", async () => {
      chatMocks.failureError = refuse({
        code: "missing_credentials",
        message: "No LLM provider is connected.",
      });
      chatMocks.failureCopies = 2;
      const props = baseProps({});
      await mount(props);

      await connectAi(props);

      expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    });

    it("does not send again when a persisted retry already answers the run", async () => {
      chatMocks.failureError = refuse({
        code: "missing_credentials",
        message: "No LLM provider is connected.",
      });
      chatMocks.thread.messages = [
        refusedMessage,
        {
          id: "user-retry",
          role: "user",
          parts: [{ type: "text", text: "Create a pitch deck" }],
          metadata: {
            hideUserMessage: true,
            custom: { agentNativeRecoveryOfRunId: "run-1" },
          },
        },
      ];
      const props = baseProps({});
      await mount(props);

      await connectAi(props);

      expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
      expect(
        container.querySelectorAll('[data-testid="builder-setup-card"]'),
      ).toHaveLength(0);
    });

    it("keeps references, model, effort and mode when the refusal arrives as a connection error", async () => {
      chatMocks.connectionError = refuse({
        code: "AGENT_CHAT_AI_SETUP_REQUIRED",
        message: "Use Builder.io or a provider API key before chatting.",
      });
      chatMocks.failureCopies = 0;
      const props = baseProps({});
      await mount(props);

      await connectAi(props);

      expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
      const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
      expect(request.text).toBe("Create a pitch deck");
      expect(request.attachments).toEqual([
        {
          type: "file",
          name: "brief.pdf",
          mediaType: "application/pdf",
          url: "https://files.example.test/brief.pdf",
        },
      ]);
      expect(request.metadata).toMatchObject({
        hideUserMessage: true,
        model: "model-original",
        engine: "engine-original",
        effort: "high",
        requestMode: "plan",
        references: [reference],
        custom: {
          agentNativeRecoveryAction: "retry",
          agentNativeRecoveryOfRunId: "user-refused",
        },
      });
    });

    // What the server persists for a turn it refused, after a reload: no client
    // error status, but the refusal marker, the run id and the retry context.
    const reloadedRefusal = {
      ...refusedMessage,
      id: "server-user-turn-1",
      status: undefined,
      metadata: {
        ...refusedMessage.metadata,
        custom: {
          submittedRunId: "turn-1",
          submittedTurnId: "turn-1",
          agentNativeRunNotStarted: true,
        },
      },
    };

    it("finds the refused prompt after a reload and resends it with its context, once per run", async () => {
      chatMocks.connectionError = refuse({
        code: "AGENT_CHAT_AI_SETUP_REQUIRED",
        message: "Use Builder.io or a provider API key before chatting.",
      });
      chatMocks.failureCopies = 0;
      chatMocks.thread.messages = [reloadedRefusal];
      const props = baseProps({});
      await mount(props);

      await connectAi(props);

      expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
      const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
      expect(request.text).toBe("Create a pitch deck");
      expect(request.metadata).toMatchObject({
        model: "model-original",
        engine: "engine-original",
        effort: "high",
        requestMode: "plan",
        references: [reference],
        custom: {
          agentNativeRecoveryOfRunId: "turn-1",
          agentNativeResumeAfterSetup: true,
        },
      });
    });

    it("resends a refused run's own prompt, not the thread's last one, and tags it as the resume", async () => {
      chatMocks.failureError = refuse({
        code: "missing_credentials",
        message: "No LLM provider is connected.",
      });
      chatMocks.thread.messages = [
        {
          ...reloadedRefusal,
          custom: undefined,
          metadata: {
            ...reloadedRefusal.metadata,
            custom: {
              ...reloadedRefusal.metadata.custom,
              submittedRunId: "run-1",
            },
          },
        },
        {
          id: "user-later",
          role: "user",
          parts: [{ type: "text", text: "A later prompt" }],
        },
      ];
      chatMocks.thread.runs = {
        "run-1": {
          id: "run-1",
          status: "failed",
          startedAt: "2026-10-01T00:00:00.000Z",
        },
      };
      const props = baseProps({});
      await mount(props);

      await connectAi(props);

      const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
      expect(request.text).toBe("Create a pitch deck");
      expect(request.metadata.custom).toMatchObject({
        agentNativeRecoveryOfRunId: "run-1",
        agentNativeResumeAfterSetup: true,
      });
    });

    it("does not tag a manual Retry as the after-setup resume", async () => {
      chatMocks.failureError = { code: "test-error", message: "Run failed" };
      chatMocks.thread.messages = [refusedMessage];
      await mount(baseProps());

      await act(async () => {
        chatMocks.failureProps.onRetry();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
      expect(request.metadata.custom).toMatchObject({
        agentNativeRecoveryAction: "retry",
      });
      expect(request.metadata.custom).not.toHaveProperty(
        "agentNativeResumeAfterSetup",
      );
    });

    it("does not resend an attachment that has nothing to upload", async () => {
      chatMocks.connectionError = refuse({
        code: "AGENT_CHAT_AI_SETUP_REQUIRED",
        message: "Use Builder.io or a provider API key before chatting.",
      });
      chatMocks.failureCopies = 0;
      chatMocks.thread.messages = [
        {
          ...refusedMessage,
          parts: [
            { type: "text", text: "Create a pitch deck" },
            { type: "file", name: "brief.pdf", mediaType: "application/pdf" },
          ],
        },
      ];
      const props = baseProps({});
      await mount(props);

      await connectAi(props);

      expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
      expect(chatMocks.setupCardProps.onRetry).toBeUndefined();
    });
  });

  it("lets a host suppress its duplicate missing-provider setup card", async () => {
    chatMocks.readiness = {
      canChat: false,
      missing: true,
      state: "missing",
    };

    await mount(
      baseProps({
        showMissingApiKeySetup: false,
      }),
    );

    expect(
      container.querySelectorAll('[data-testid="builder-setup-card"]'),
    ).toHaveLength(0);
  });

  it("dispatches custom-transport running changes to the chat host", async () => {
    const runningEvents: CustomEvent[] = [];
    const onRunning = (event: Event) =>
      runningEvents.push(event as CustomEvent);
    const createTransport = () => chatMocks.transport;
    window.addEventListener("agentNative.chatRunning", onRunning);
    await mount(baseProps({ createTransport, tabId: "custom-tab" }));
    chatMocks.thread.activeRunIds = ["custom-run"];

    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          {...baseProps({ createTransport, tabId: "custom-tab" })}
        />,
      );
    });

    expect(
      runningEvents.some(
        (event) =>
          event.detail.isRunning === true &&
          event.detail.threadId === "thread-1" &&
          event.detail.tabId === "custom-tab" &&
          event.detail.runId === "custom-run",
      ),
    ).toBe(true);
    window.removeEventListener("agentNative.chatRunning", onRunning);
  });

  it("persists changed custom-transport snapshots through the protocol save", async () => {
    const createTransport = () => chatMocks.transport;
    const onSaveThread = vi.fn();
    const message = {
      id: "custom-user-message",
      role: "user",
      status: "complete",
      createdAt: "2026-10-07T12:00:00.000Z",
      parts: [{ type: "text", text: "Save this message" }],
    };
    await mount(baseProps({ createTransport, onSaveThread }));

    chatMocks.thread = {
      ...chatMocks.thread,
      thread: null,
      messages: [message],
    };
    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          {...baseProps({ createTransport, onSaveThread })}
        />,
      );
    });
    await flush();

    expect(chatMocks.persistThreadSnapshot).toHaveBeenCalledWith("thread-1", [
      expect.objectContaining({ id: "custom-user-message" }),
    ]);
    expect(onSaveThread).toHaveBeenCalledOnce();
  });

  it("removes inline image bodies from every persisted thread snapshot path", async () => {
    const createTransport = () => chatMocks.transport;
    const onSaveThread = vi.fn();
    const inlineImageUrl = "data:image/png;base64,INLINE_SQL_IMAGE_BYTES";
    const pastedSseLine = 'data: {"message":"hello"}';
    const message = {
      id: "user-with-inline-image",
      role: "user",
      status: "complete",
      createdAt: "2026-10-07T12:00:00.000Z",
      parts: [
        { type: "text", text: "Describe this" },
        { type: "text", text: pastedSseLine },
        {
          type: "file",
          name: "reference.png",
          mediaType: "image/png",
          url: inlineImageUrl,
          data: inlineImageUrl,
        },
        {
          type: "image",
          name: "reference.png",
          data: inlineImageUrl,
        },
      ],
      metadata: {
        custom: {
          agentNativeRetryRequestAttachments: [
            {
              type: "image",
              name: "reference.png",
              data: inlineImageUrl,
              url: inlineImageUrl,
              referenceUrl: inlineImageUrl,
            },
          ],
        },
      },
    };
    const queuedMessage = {
      id: "queued-with-inline-image",
      threadId: "thread-1",
      text: "Describe this next",
      createdAt: "2026-10-07T12:01:00.000Z",
      attachments: [
        {
          type: "file",
          name: "reference.png",
          mediaType: "image/png",
          url: inlineImageUrl,
        },
      ],
      requestAttachments: [
        {
          type: "image",
          name: "reference.png",
          data: inlineImageUrl,
          url: inlineImageUrl,
          referenceUrl: inlineImageUrl,
        },
      ],
    };
    await mount(baseProps({ createTransport, onSaveThread }));

    chatMocks.thread = {
      ...chatMocks.thread,
      messages: [message],
      queuedMessages: [queuedMessage],
    };
    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          {...baseProps({ createTransport, onSaveThread })}
        />,
      );
    });
    await flush();

    expect(onSaveThread).toHaveBeenCalledOnce();
    const snapshot = onSaveThread.mock.calls[0]?.[1];
    expect(JSON.stringify(snapshot)).not.toContain("data:image/");
    expect(JSON.stringify(snapshot)).not.toContain("INLINE_SQL_IMAGE_BYTES");
    const repository = JSON.parse(snapshot.threadData);
    expect(repository.agentKit.messages[0].parts).toContainEqual({
      type: "text",
      text: pastedSseLine,
    });
    expect(repository.queuedMessages[0].attachments[0]).not.toHaveProperty(
      "url",
    );
    expect(repository.queuedMessages[0].requestAttachments).toEqual([]);
    expect(chatMocks.persistThreadSnapshot).toHaveBeenCalledWith("thread-1", [
      expect.objectContaining({ id: "user-with-inline-image" }),
    ]);
    const persistedMessages = JSON.stringify(
      chatMocks.persistThreadSnapshot.mock.calls[0]?.[1],
    );
    expect(persistedMessages).not.toContain("data:image/");
    expect(persistedMessages).not.toContain("INLINE_SQL_IMAGE_BYTES");
  });

  it("shows an expired-session card and emits the session-expired event", async () => {
    chatMocks.failureError = { code: "unauthorized", message: "HTTP 401" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "unauthorized" }, { status: 401 }),
      ),
    );
    const authEvents: CustomEvent[] = [];
    const onAuthError = (event: Event) => authEvents.push(event as CustomEvent);
    window.addEventListener("agent-chat:auth-error", onAuthError);
    await mount(baseProps());

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:auth-error", {
          detail: { reason: "session-expired", threadId: "thread-1" },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      authEvents.some((event) => event.detail.reason === "session-expired"),
    ).toBe(true);
    expect(container.textContent).toContain("agentChat.auth.expiredTitle");
    expect(container.textContent).toContain("agentChat.auth.logOut");
    window.removeEventListener("agent-chat:auth-error", onAuthError);
  });

  it.each(["host", "controller"])(
    "shows cancellation errors from the %s and permits retry",
    async (source) => {
      chatMocks.thread.activeRunIds = ["run-stop"];
      chatMocks.thread.runs = {
        "run-stop": { id: "run-stop", status: "running" },
      };
      const onStop = vi.fn(async () => true);
      if (source === "host")
        onStop.mockRejectedValueOnce(new Error("Stop unavailable"));
      else
        chatMocks.control.cancel.mockRejectedValueOnce(
          new Error("Stop unavailable"),
        );
      await mount(baseProps({ onStop }));
      await act(async () => {
        chatMocks.composerProps.stopButton.props.onClick();
        await Promise.resolve();
      });
      const alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("Stop unavailable");
      const message = Array.from(alert?.querySelectorAll("span") ?? []).find(
        (element) => element.textContent === "Stop unavailable",
      );
      expect(message?.hasAttribute("data-an-mask")).toBe(true);
      expect(alert?.hasAttribute("data-an-mask")).toBe(false);
      expect(alert?.querySelector("button")?.closest("[data-an-mask]")).toBe(
        null,
      );
      await act(async () => {
        chatMocks.composerProps.stopButton.props.onClick();
        await Promise.resolve();
      });
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(chatMocks.control.cancel).toHaveBeenLastCalledWith("run-stop");
    },
  );

  it("routes first-class approval decisions through host policy hooks", async () => {
    chatMocks.approvalRequest = {
      id: "approval-1",
      title: "Allow publishing?",
      description: "publish-release",
      kind: "approval",
      metadata: { toolName: "publish-release" },
    };
    const onDeny = vi.fn();
    const onAlwaysAllow = vi.fn(async () => undefined);
    await mount(baseProps({ approvalActions: { onDeny, onAlwaysAllow } }));

    const denyButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "agentChat.approval.deny",
    );
    const alwaysAllowButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "agentChat.approval.alwaysAllowAction",
    );
    expect(denyButton).toBeDefined();
    expect(alwaysAllowButton).toBeDefined();

    await act(async () => {
      denyButton?.click();
      await Promise.resolve();
    });
    expect(chatMocks.control.resolveApproval).toHaveBeenCalledWith(
      "run-1",
      "approval-1",
      { decision: "deny", optionIds: ["deny"] },
    );
    expect(onDeny).toHaveBeenCalledWith("approval-1");

    await act(async () => {
      alwaysAllowButton?.click();
      await Promise.resolve();
    });
    expect(onAlwaysAllow).toHaveBeenCalledWith("approval-1", "publish-release");
    expect(chatMocks.control.resolveApproval).toHaveBeenLastCalledWith(
      "run-1",
      "approval-1",
      { decision: "approve", optionIds: ["approve"] },
    );
  });

  it.each(["approve", "deny"])(
    "shows a failed %s decision and clears it on retry",
    async (decision) => {
      chatMocks.approvalRequest = {
        id: "approval-failed",
        title: "Allow publishing?",
        metadata: { toolName: "publish-release" },
      };
      chatMocks.control.resolveApproval.mockRejectedValueOnce(
        new Error("Approval unavailable"),
      );
      await mount(baseProps());
      const action = decision === "approve" ? "onApprove" : "onDeny";
      await act(async () => {
        chatMocks.approvalCardProps[action]();
        await Promise.resolve();
      });
      expect(chatMocks.approvalCardProps.saveFailedLabel).toBe(
        "agentChat.common.saveFailed",
      );
      expect(chatMocks.approvalCardProps.isAlwaysAllowing).toBe(false);
      await act(async () => {
        chatMocks.approvalCardProps[action]();
        await Promise.resolve();
      });
      expect(chatMocks.approvalCardProps.saveFailedLabel).toBeUndefined();
    },
  );

  it("labels host always-allow approval actions with their declared scope", async () => {
    chatMocks.approvalRequest = {
      id: "approval-exact-command",
      title: "Allow this command?",
      description: "run-command",
      kind: "approval",
      metadata: { toolName: "run-command" },
    };
    const onAlwaysAllow = vi.fn(async () => undefined);
    await mount(
      baseProps({
        approvalActions: {
          onAlwaysAllow,
          alwaysAllowScope: "exact-command",
        },
      }),
    );

    expect(chatMocks.approvalCardProps).toMatchObject({
      alwaysAllowLabel: "agentChat.approval.alwaysAllow",
      alwaysAllowHint: "agentChat.approval.alwaysAllowHint",
    });
  });

  it("persists the shared approval policy before approving by default", async () => {
    chatMocks.approvalRequest = {
      id: "approval-default-policy",
      title: "Allow publishing?",
      description: "publish-release",
      kind: "approval",
      metadata: { toolName: "publish-release" },
    };
    await mount(baseProps());

    const alwaysAllowButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "agentChat.approval.alwaysAllowAction",
    );
    expect(alwaysAllowButton).toBeDefined();

    await act(async () => {
      alwaysAllowButton?.click();
      await Promise.resolve();
    });

    expect(chatMocks.callAction).toHaveBeenCalledWith(
      "set-tool-approval-policy",
      { toolName: "publish-release", enabled: true },
    );
    expect(chatMocks.control.resolveApproval).toHaveBeenCalledWith(
      "run-1",
      "approval-default-policy",
      { decision: "approve", optionIds: ["approve"] },
    );
  });

  it("opens active reasoning and omits explicitly hidden reasoning", async () => {
    chatMocks.thread.events = [
      {
        id: "reasoning-event",
        type: "reasoning.delta",
        messageId: "assistant-reasoning",
        runId: "run-reasoning",
      },
    ];
    chatMocks.thread.runs = {
      "run-reasoning": {
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:02.000Z",
      },
    };
    await mount(baseProps());
    const Reasoning = chatMocks.rootProps.slots.reasoning;

    await act(async () => {
      root.render(
        <Reasoning
          threadId="thread-1"
          resetKey="thread-1:assistant-reasoning:0"
          active
          value={{ type: "reasoning", text: "Checking the result." }}
        />,
      );
    });
    expect(chatMocks.reasoningProps).toMatchObject({
      defaultOpen: true,
      isStreaming: true,
      resetKey: "thread-1:assistant-reasoning:0",
    });
    expect(chatMocks.reasoningProps).not.toHaveProperty("durationMs");

    await act(async () => {
      root.render(
        <Reasoning
          threadId="thread-1"
          resetKey="thread-1:assistant-reasoning:0"
          active={false}
          value={{
            type: "reasoning",
            visibility: "hidden",
            text: "Private chain of thought.",
          }}
        />,
      );
    });
    expect(container.textContent).toBe("");
  });

  it("uses Core's friendly formatter for recognized run errors", async () => {
    chatMocks.failureError = {
      code: "context_length_exceeded",
      message: "The request exceeded the model context window.",
    };
    await mount(baseProps());

    expect(chatMocks.failureProps.info.message).toContain(
      "[agentChat.errorMessages.startNewChat](agent-native:new-chat)",
    );
  });

  it("activates the thread returned by run recovery fork", async () => {
    const onForkedThread = vi.fn();
    chatMocks.thread.messages = [
      {
        id: "user-1",
        role: "user",
        createdAt: new Date().toISOString(),
        parts: [{ type: "text", text: "Original request" }],
      },
    ];
    await mount(baseProps({ onForkedThread }));

    await act(async () => {
      await chatMocks.failureProps.onFork();
    });

    expect(chatMocks.control.fork).toHaveBeenCalledWith("user-1");
    expect(onForkedThread).toHaveBeenCalledWith("thread-forked");
  });
});
