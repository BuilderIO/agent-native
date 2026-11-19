// @vitest-environment jsdom
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { AgentKitAssistantChat } from "./AgentKitAssistantChat.js";
import type { AssistantChatHandle } from "./chat/surface-types.js";

const mocks = vi.hoisted(() => ({
  rootProps: null as any,
  transportOptions: null as any,
  queueMessage: vi.fn(),
  uploadFiles: vi.fn(),
  thread: {
    thread: null,
    messages: [],
    events: [],
    activeRunIds: [],
    runs: {},
    approvals: {},
    connectionRequests: {},
    suggestions: [],
    tools: {},
    activities: {},
    queuedMessages: [],
  },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../agentkit/react/root.js", () => ({
  AgentKitRoot: (props: any) => {
    mocks.rootProps = props;
    return props.children;
  },
}));

vi.mock("../agentkit/react/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../agentkit/react/index.js")>();
  const { AgentKitPendingSubmissionStore } =
    await import("../agentkit/react/pending-submissions.js");
  const pending = new AgentKitPendingSubmissionStore();
  return {
    ...actual,
    AgentKitChat: () => null,
    useAgentKit: () => ({
      threadId: "thread-1",
      slots: mocks.rootProps?.slots ?? {},
      requestComposerFocus: vi.fn(),
      controller: {
        getThread: () => mocks.thread,
        assertAiSetupReady: async () => undefined,
      },
    }),
    useAgentKitControl: () => ({
      queueMessage: mocks.queueMessage,
      uploadFiles: mocks.uploadFiles,
    }),
    useAgentKitBeginPendingSubmission:
      () => (threadId: string, draft: any, options?: any) =>
        pending.begin(threadId, draft, options),
    useAgentKitPendingSubmissions: () => [],
    useAgentKitSubmissionHoldsTurn: () => false,
    useAgentKitStopButton: () => undefined,
    useAgentThread: () => mocks.thread,
    useAgentThreadSelector: (
      select: (thread: typeof mocks.thread) => unknown,
    ) => select(mocks.thread),
  };
});

vi.mock("./agentkit-chat/history.js", () => ({
  AgentKitDevCheckpointProvider: ({ children }: any) => children,
  AgentKitDevCheckpointRestore: () => null,
  useOptionalAgentKitHistory: () => null,
}));

vi.mock("./agentkit-chat/index.js", async () => {
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
              useAgentEngineConfigured: () => ({
                canChat: true,
                missing: false,
                state: "configured",
              }),
              fetchAgentEngineConfiguredState: async () => "configured",
            },
          },
        },
        children,
      ),
    createAgentNativeAgentKitTransport: (options: unknown) => {
      mocks.transportOptions = options;
      return {};
    },
    findMcpConnectionSuggestionIntegration: () => null,
    GuidedQuestionProviderGate: () => null,
    GuidedQuestionCard: () => null,
    McpAgentKitConnectionRequestCard: () => null,
    McpAgentKitConnectionResume: () => null,
    McpConnectionSuggestion: () => null,
    AgentKitHistoryBeginningRevert: () => null,
    AgentKitHistoryMessageSupplement: () => null,
    AgentKitHistoryProvider: ({ children }: any) => children,
    useGuidedQuestionFlow: () => ({ questions: [] }),
    useRefetchGuidedQuestionsWhenAsked: () => undefined,
  };
});

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/client/agent-chat")
    >();
  return {
    ...actual,
    createAgentNativeChatRuntime: () => ({}),
    useAgentDynamicSuggestionsResult: () => ({ suggestions: [] }),
    useAgentEngineConfigured: () => ({
      canChat: true,
      missing: false,
      state: "configured",
    }),
    getAgentChatContextState: () => ({ items: [], updatedAt: 0 }),
    refreshAgentChatContext: vi.fn(async () => undefined),
    subscribeAgentChatContext: () => () => undefined,
    readAssistantChatComposerDraft: () => null,
    writeAssistantChatComposerDraft: vi.fn(),
  };
});
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => true),
  deleteClientAppState: vi.fn(async () => undefined),
  isClientAppStateMutationPending: () => false,
  readClientAppState: vi.fn(async () => null),
  writeClientAppState: vi.fn(async () => undefined),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatNumber: String, formatDate: String }),
}));
vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => ({
    data: { configured: true },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: {
      authUserId: "user-1",
      email: "test@example.test",
      orgId: "workspace-1",
    },
    status: "authenticated",
  }),
}));

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  vi.restoreAllMocks();
});

it("shows the localized Builder reconnect error for a queued upload", async () => {
  const serverMessage = "Untrusted storage provider details";
  const originalFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
    String(input).startsWith("data:")
      ? originalFetch(input, init)
      : Promise.resolve(
          Response.json(
            {
              errorCode: "builder_oauth_reauthorization_required",
              error: serverMessage,
            },
            { status: 503 },
          ),
        ),
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  const ref = createRef<AssistantChatHandle>();
  await act(async () =>
    root.render(
      <AgentKitAssistantChat threadId="thread-1" isNewThread ref={ref} />,
    ),
  );
  const chat = ref.current;
  if (!chat) throw new Error("Chat did not mount");
  mocks.uploadFiles.mockImplementationOnce(async (files) => {
    await mocks.rootProps.clientOptions.upload(
      await mocks.transportOptions.operations.createUpload({
        threadId: "test-thread",
        descriptor: {
          name: files[0].name,
          mediaType: files[0].mediaType,
          size: files[0].size,
          purpose: "message",
        },
      }),
      files[0],
    );
    return [];
  });
  await act(async () => {
    await expect(
      chat.queueMessage("Describe this later", [
        "data:image/png;base64,SGVsbG8=",
      ]),
    ).rejects.toMatchObject({
      message: "agentChat.composer.uploadBuilderReconnect",
      code: "upload_builder_oauth_reauthorization_required",
      status: 503,
      retryable: false,
    });
  });
  expect(container.textContent).toContain(
    "agentChat.composer.uploadBuilderReconnect",
  );
  expect(container.textContent).not.toContain(serverMessage);
  expect(mocks.queueMessage).not.toHaveBeenCalled();
});
