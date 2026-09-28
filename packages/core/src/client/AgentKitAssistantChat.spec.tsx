// @vitest-environment happy-dom

import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chatMocks = vi.hoisted(() => ({
  appState: new Map<string, unknown>(),
  composerDrafts: new Map<string, string>(),
  threadId: "thread-1",
  readThread: () => chatMocks.thread,
  thread: {
    thread: null,
    messages: [] as any[],
    events: [] as any[],
    activeRunIds: [] as string[],
    tools: {} as Record<string, unknown>,
    activities: {} as Record<string, unknown>,
    queuedMessages: [] as any[],
  },
  rootProps: null as any,
  chatProps: null as any,
  composerProps: null as any,
  resumeProps: null as any,
  failureProps: null as any,
  failureError: { code: "test-error", message: "Run failed" } as any,
  setupCardProps: null as any,
  suggestionBarProps: null as any,
  dynamicSuggestionOptions: null as any,
  approvalRequest: null as any,
  approvalCardProps: null as any,
  reasoningProps: null as any,
  thinkingDisplay: null as any,
  requestComposerFocus: vi.fn(),
  readiness: { canChat: true, missing: false, state: "configured" },
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

vi.mock("@agent-native/agentkit/react", async () => {
  const React = await import("react");
  const { useThinkingDisplay } = await import("./thinking-display.js");
  return {
    AgentKitChat: (props: unknown) => {
      chatMocks.chatProps = props;
      chatMocks.thinkingDisplay = useThinkingDisplay();
      const slots = chatMocks.rootProps?.slots;
      const Composer = slots?.composer;
      const Transcript = slots?.transcript;
      const Failure = slots?.runFailure;
      const Approval = slots?.approval;
      const MessageSupplement = slots?.messageSupplement;
      return React.createElement(
        React.Fragment,
        null,
        Composer
          ? React.createElement(Composer, { threadId: chatMocks.threadId })
          : null,
        Transcript
          ? React.createElement(Transcript, {
              threadId: chatMocks.threadId,
              children: null,
            })
          : null,
        Failure
          ? React.createElement(Failure, {
              error: chatMocks.failureError,
              runId: "run-1",
              threadId: chatMocks.threadId,
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
    AgentKitComposer: (props: unknown) => {
      chatMocks.composerProps = props;
      return null;
    },
    AgentApprovalPrompt: () => null,
    AgentMessageView: ({ value }: any) => {
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
    useAgentKit: () => ({
      threadId: chatMocks.threadId,
      requestComposerFocus: chatMocks.requestComposerFocus,
      controller: {},
    }),
    useAgentKitControl: () => chatMocks.control,
    useAgentThread: () => chatMocks.readThread(),
  };
});

vi.mock("@agent-native/agentkit/react/root", async () => {
  const React = await import("react");
  const actual =
    await import("../../../../packages/agentkit/src/react/root.js");
  return {
    AgentKitRoot: (props: any) => {
      chatMocks.rootProps = props;
      return chatMocks.useRealRoot
        ? React.createElement(actual.AgentKitRoot, props)
        : props.children;
    },
  };
});

vi.mock("@agent-native/toolkit/composer", () => ({
  AgentSuggestionBar: (props: unknown) => {
    chatMocks.suggestionBarProps = props;
    return null;
  },
  agentSuggestionPrompt: (suggestion: any) =>
    typeof suggestion === "string" ? suggestion : suggestion.prompt,
}));

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

vi.mock("@tabler/icons-react", () =>
  Object.fromEntries(
    [
      "IconAlertTriangle",
      "IconCheck",
      "IconChevronDown",
      "IconMessage",
      "IconPlayerStopFilled",
      "IconQuote",
      "IconRefresh",
      "IconShieldCheck",
      "IconX",
    ].map((name) => [name, () => null]),
  ),
);

vi.mock("./agentkit-chat/history.js", async () => {
  const React = await import("react");
  return {
    AgentKitDevCheckpointProvider: ({ children }: any) =>
      React.createElement(React.Fragment, null, children),
    AgentKitDevCheckpointRestore: () => null,
    useOptionalAgentKitHistory: () => undefined,
  };
});

vi.mock("./agentkit-chat/index.js", async () => {
  const React = await import("react");
  return {
    CoreComposerRuntimeProvider: ({ children }: any) =>
      React.createElement(React.Fragment, null, children),
    createAgentNativeAgentKitTransport: chatMocks.createTransport,
    findMcpConnectionSuggestionIntegration: () => null,
    GuidedQuestionProviderGate: () => null,
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
    AgentKitHistoryBeginningRevert: () => null,
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

vi.mock("./application-state.js", () => ({
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
  readClientAppState: vi.fn(
    async (key: string) => chatMocks.appState.get(key) ?? null,
  ),
  writeClientAppState: vi.fn(async (key: string, value: unknown) => {
    chatMocks.appState.set(key, value);
    return value;
  }),
}));

vi.mock("./builder-frame.js", () => ({
  isInBuilderFrame: () => chatMocks.inBuilder,
}));

vi.mock("./chat/composer-draft.js", () => ({
  readAssistantChatComposerDraft: (key: string) =>
    chatMocks.composerDrafts.get(key) ?? null,
  writeAssistantChatComposerDraft: vi.fn((key: string, text: string) => {
    chatMocks.composerDrafts.set(key, text);
  }),
}));

vi.mock("./chat/run-recovery.js", () => ({
  RunErrorRecoveryCard: (props: unknown) => {
    chatMocks.failureProps = props;
    return null;
  },
  BuilderSetupCard: (props: unknown) => {
    chatMocks.setupCardProps = props;
    return null;
  },
  LoopLimitContinueCard: () => null,
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

vi.mock("./uploads/use-file-upload-status.js", () => ({
  useFileUploadStatus: () => chatMocks.fileUploadStatus,
}));

vi.mock("./chat/runtime.js", () => ({
  createAgentNativeChatRuntime: chatMocks.createRuntime,
}));

vi.mock("./chat/markdown-renderer.js", () => ({
  renderMarkdownToClipboardHtml: chatMocks.renderMarkdownToClipboardHtml,
}));

vi.mock("./clipboard.js", () => ({
  writeClipboardText: chatMocks.writeClipboardText,
}));

vi.mock("./dynamic-suggestions.js", () => ({
  useAgentDynamicSuggestionsResult: (options: unknown) => {
    chatMocks.dynamicSuggestionOptions = options;
    return {
      suggestions: (options as { staticSuggestions?: string[] })
        .staticSuggestions,
    };
  },
}));

vi.mock("./external-agent-host.js", () => ({ ExternalAgentNudge: () => null }));

vi.mock("./i18n.js", () => ({
  useFormatters: () => ({
    formatNumber: String,
    formatDate: (value: string) => value,
  }),
  useT: () => (key: string, options?: Record<string, unknown>) =>
    key === "agentChat.composer.previewAttachment"
      ? `Preview ${String(options?.name ?? "{{name}}")}`
      : key,
}));

vi.mock("./RunStuckBanner.js", () => ({ RunStuckBanner: () => null }));

vi.mock("./use-dev-mode.js", () => ({
  useDevMode: () => ({ isDevMode: true }),
}));

vi.mock("./use-action.js", () => ({ callAction: chatMocks.callAction }));

vi.mock("./use-agent-engine-configured.js", () => ({
  useAgentEngineConfigured: () => chatMocks.readiness,
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

vi.mock("./agent-chat.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-chat.js")>();
  return {
    ...actual,
    filterAgentChatContextItems: (items: unknown[]) => items,
    formatAgentChatContextItemsForPrompt: () => "",
    getAgentChatContextState: () => ({ items: [], updatedAt: 0 }),
    publishAgentChatContextItems: vi.fn(),
    refreshAgentChatContext: vi.fn(async () => undefined),
    subscribeAgentChatContext: vi.fn(() => () => undefined),
  };
});

import {
  AGENT_CHAT_SUBMIT_RESULT_EVENT,
  appendAgentChatContextToMessage,
  _resetAgentChatContextForTests,
} from "./agent-chat.js";
import {
  AgentKitAssistantChat,
  type AgentKitAssistantChatProps,
} from "./AgentKitAssistantChat.js";
import { deleteClientAppState } from "./application-state.js";
import type {
  AssistantChatHandle,
  AssistantChatSendOptions,
} from "./chat/surface-types.js";

let container: HTMLDivElement;
let root: Root;

async function mount(props: AgentKitAssistantChatProps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<AgentKitAssistantChat {...props} />);
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
    providerStatusChecksEnabled: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(deleteClientAppState)
    .mockReset()
    .mockImplementation(async (key) => {
      chatMocks.appState.delete(key);
    });
  chatMocks.appState.clear();
  chatMocks.composerDrafts.clear();
  chatMocks.threadId = "thread-1";
  chatMocks.thread = {
    thread: null,
    messages: [],
    events: [],
    activeRunIds: [],
    runs: {},
    tools: {},
    activities: {},
    queuedMessages: [],
  };
  chatMocks.readThread = () => chatMocks.thread;
  chatMocks.rootProps = null;
  chatMocks.chatProps = null;
  chatMocks.composerProps = null;
  chatMocks.resumeProps = null;
  chatMocks.failureProps = null;
  chatMocks.failureError = { code: "test-error", message: "Run failed" };
  chatMocks.setupCardProps = null;
  chatMocks.suggestionBarProps = null;
  chatMocks.dynamicSuggestionOptions = null;
  chatMocks.approvalRequest = null;
  chatMocks.approvalCardProps = null;
  chatMocks.reasoningProps = null;
  chatMocks.thinkingDisplay = null;
  chatMocks.requestComposerFocus.mockReset();
  chatMocks.readiness = {
    canChat: true,
    missing: false,
    state: "configured",
  };
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
  chatMocks.voiceTranscriptRegistration = null;
  chatMocks.control.sendMessage.mockReset().mockResolvedValue(undefined);
  chatMocks.control.queueMessage.mockReset().mockResolvedValue(undefined);
  chatMocks.control.resolveConnectionRequest
    .mockReset()
    .mockResolvedValue(undefined);
  chatMocks.control.resolveApproval.mockReset().mockResolvedValue(undefined);
  chatMocks.control.fork.mockReset().mockResolvedValue({ id: "thread-forked" });
  chatMocks.control.uploadFiles.mockReset().mockResolvedValue([]);
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
  _resetAgentChatContextForTests();
});

afterEach(async () => {
  await unmount();
  window.sessionStorage.clear();
});

describe("AgentKitAssistantChat host behavior", () => {
  it("places empty home content and starter prompts above the composer", async () => {
    await mount(
      baseProps({
        centerComposerWhenEmpty: true,
        suggestionPlacement: "context-chips",
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
    await act(async () => retryButton!.click());
    expect(chatMocks.rootProps.load).toBe("manual");
    await flush();
    expect(chatMocks.rootProps.load).toBe("auto");
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

  it("waits for pending-selection cleanup before sending", async () => {
    let resolveDelete!: () => void;
    vi.mocked(deleteClientAppState).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    await mount(baseProps());

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
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      resolveDelete();
      await submitPromise;
    });

    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
  });

  it("durably queues unresolved sends with files and references across remounts", async () => {
    chatMocks.readiness = {
      canChat: false,
      missing: false,
      state: "unknown",
    };
    chatMocks.control.uploadFiles.mockResolvedValueOnce([
      {
        type: "file",
        name: "notes.txt",
        mediaType: "text/plain",
        url: "https://files.example.test/notes.txt",
      },
    ]);
    chatMocks.guidedQuestions = [{ id: "question-1" }];
    const ref = createRef<AssistantChatHandle>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const props = baseProps({
      providerStatusChecksEnabled: true,
      tabId: "tab-1",
    });
    await act(async () => {
      root.render(<AgentKitAssistantChat ref={ref} {...props} />);
    });
    const results: CustomEvent[] = [];
    const listener = (event: Event) => results.push(event as CustomEvent);
    window.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, listener);
    const reference = {
      type: "file",
      path: "notes.txt",
      name: "notes.txt",
      source: "composer",
    } as const;

    await act(async () => {
      ref.current?.prefillMessage("Visible composer draft");
      await ref.current?.sendMessage("Wait for the provider", undefined, {
        submitMessageId: "pending-provider-submit",
        attachments: [
          {
            type: "text/plain",
            name: "notes.txt",
            text: "private attachment body",
          },
        ],
        recoveryReferences: [reference],
      } as AssistantChatSendOptions);
    });

    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(results.map((event) => event.detail)).toEqual([
      { submitMessageId: "pending-provider-submit", delivered: true },
    ]);
    expect(chatMocks.composerProps.initialText).toBe("Visible composer draft");
    expect(chatMocks.guidedFlowProps).toMatchObject({
      isSubmissionBlocked: true,
      providerStatus: "unknown",
    });
    const stateKey = [...chatMocks.appState.keys()].find((key) =>
      key.startsWith("agentkit-deferred-provider-submissions:"),
    );
    expect(stateKey).toBeDefined();
    const persisted = chatMocks.appState.get(stateKey!) as {
      submissions: Array<{
        fileParts: unknown[];
        options: { recoveryReferences: unknown[] };
      }>;
    };
    expect(persisted.submissions[0]).toMatchObject({
      fileParts: [
        {
          type: "file",
          name: "notes.txt",
          url: "https://files.example.test/notes.txt",
        },
      ],
      options: { recoveryReferences: [reference] },
    });
    expect(JSON.stringify(persisted)).not.toContain("private attachment body");

    await unmount();
    root = undefined as unknown as Root;

    chatMocks.readiness = {
      canChat: true,
      missing: false,
      state: "configured",
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<AgentKitAssistantChat ref={ref} {...props} />);
    });
    await flush();

    expect(chatMocks.composerProps.initialText).toBe("Visible composer draft");
    expect(chatMocks.control.sendMessage).toHaveBeenCalledOnce();
    const request = chatMocks.control.sendMessage.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      text: "Wait for the provider",
      attachments: [
        {
          type: "file",
          name: "notes.txt",
          url: "https://files.example.test/notes.txt",
        },
      ],
      metadata: {
        references: [reference],
        custom: {
          agentNativeDeferredSubmissionId: "pending-provider-submit",
        },
      },
    });
    expect(results).toHaveLength(1);
    expect(chatMocks.appState.has(stateKey!)).toBe(false);
    window.removeEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, listener);
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
      root.render(
        <AgentKitAssistantChat
          ref={ref}
          {...baseProps({ providerStatusChecksEnabled: true })}
        />,
      );
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

    chatMocks.readiness = {
      canChat: false,
      missing: false,
      state: "unavailable",
    };
    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          ref={ref}
          {...baseProps({ providerStatusChecksEnabled: true })}
        />,
      );
    });
    await expect(
      ref.current!.sendMessage("Try again", undefined, {
        submitMessageId: "unavailable-submit",
      }),
    ).resolves.toEqual({ status: "submitted" });
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
    expect(results.at(-1)?.detail).toEqual({
      submitMessageId: "unavailable-submit",
      delivered: true,
    });

    chatMocks.readiness = {
      canChat: true,
      missing: false,
      state: "configured",
    };
    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          ref={ref}
          {...baseProps({ providerStatusChecksEnabled: true })}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(chatMocks.control.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Try again" }),
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

    expect(chatMocks.control.queueMessage).toHaveBeenCalledTimes(2);
    expect(chatMocks.control.queueMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ text: "Next imperative turn" }),
    );
    expect(chatMocks.control.queueMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: "Next guided turn" }),
    );
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
  });

  it("forwards slash commands and localized labels to AgentKit", async () => {
    const onSlashCommand = vi.fn();
    chatMocks.inBuilder = true;
    await mount(baseProps({ onSlashCommand }));

    expect(chatMocks.composerProps.includeDefaultSlashCommands).toBe(true);
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
      queueMoveToTop: "agentChat.queue.moveToTop",
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

    await act(async () => {
      await chatMocks.resumeProps.onMessageResume({
        message: "Continue after connecting the integration.",
      });
    });
    expect(chatMocks.control.queueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Continue after connecting the integration.",
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

    expect(chatMocks.control.queueMessage).toHaveBeenCalledOnce();
    expect(chatMocks.control.queueMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Continue after OAuth." }),
    );
    expect(chatMocks.control.sendMessage).not.toHaveBeenCalled();
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
    const { createAgentNativeAgentKitTransport } =
      await import("./chat/agentkit-agent-native.js");
    let resolveNotFound!: (response: Response) => void;
    const notFoundResponse = new Promise<Response>((resolve) => {
      resolveNotFound = resolve;
    });
    const fetch = vi.fn(async () => notFoundResponse);
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
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => {
      resolveNotFound(new Response(null, { status: 404 }));
    });
    await flush();

    expect(onThreadRestoreNotFound).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("agentChat.message.threadNotFound");
  });

  it("hands a recent snapshot across surfaces while thread persistence lags", async () => {
    const { createAgentNativeAgentKitTransport } =
      await import("./chat/agentkit-agent-native.js");
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
    chatMocks.threadId = threadId;
    chatMocks.thread = {
      thread: {
        id: threadId,
        title: "Handoff thread",
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
    await act(async () => {
      root.render(
        <AgentKitAssistantChat
          {...baseProps({
            threadId,
            browserTabId,
            isNewThread: false,
            onSaveThread: savedSnapshots,
            centerComposerWhenEmpty: true,
            suggestionPlacement: "context-chips",
            homeIntroSlot: <h1>What should we do?</h1>,
            afterComposerSlot: <div data-testid="home-app-grid" />,
            suggestions: ["Explore my apps"],
          })}
        />,
      );
    });

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
    expect(handoff.messages[0].parts).toContainEqual({
      type: "text",
      text: "Keep this transcript visible",
    });
    expect(handoff.messages[1].parts).toContainEqual({
      type: "text",
      text: "Assistant answer survives handoff",
    });
    expect(fetch).not.toHaveBeenCalled();
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

  it("shows a localized Stop tooltip and bounces the blocked setup card", async () => {
    chatMocks.readiness = {
      canChat: false,
      missing: true,
      state: "missing",
    };
    chatMocks.thread.activeRunIds = ["run-1"];
    const blockedEvents: CustomEvent[] = [];
    const providerRefreshEvents: Event[] = [];
    const onBlocked = (event: Event) =>
      blockedEvents.push(event as CustomEvent);
    const onProviderRefresh = (event: Event) =>
      providerRefreshEvents.push(event);
    window.addEventListener("agent-chat:missing-api-key", onBlocked);
    window.addEventListener(
      "agent-engine:configured-changed",
      onProviderRefresh,
    );
    await mount(baseProps({ providerStatusChecksEnabled: true }));

    expect(
      container
        .querySelector(".agentkit-host-composer")
        ?.classList.contains("agent-composer-area--attached-above"),
    ).toBe(true);
    expect(chatMocks.setupCardProps.onRetry).toEqual(expect.any(Function));
    await act(async () => chatMocks.setupCardProps.onRetry());
    expect(providerRefreshEvents).toHaveLength(1);
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
    window.removeEventListener(
      "agent-engine:configured-changed",
      onProviderRefresh,
    );
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
      durationMs: 2000,
    });

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
