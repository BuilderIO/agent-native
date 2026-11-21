// @vitest-environment jsdom
import type { AgentKitController } from "@agent-native/agentkit/client";
import type { AgentTransport } from "@agent-native/agentkit/protocol";
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { AgentKitRootProps } from "../agentkit/react/root.js";
import { AgentKitAssistantChat } from "./AgentKitAssistantChat.js";
import type { AssistantChatHandle } from "./chat/surface-types.js";

const mocks = vi.hoisted(() => ({
  rootProps: null as AgentKitRootProps | null,
  transportOptions: null as {
    operations: { createUpload: NonNullable<AgentTransport["createUpload"]> };
  } | null,
  queueMessage: vi.fn(),
  uploadFiles:
    vi.fn<
      (
        files: Parameters<AgentKitController["uploadFiles"]>[1],
      ) => ReturnType<AgentKitController["uploadFiles"]>
    >(),
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
  AgentKitRoot: (props: AgentKitRootProps) => {
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
      () =>
      (...args: Parameters<typeof pending.begin>) =>
        pending.begin(...args),
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
  AgentKitDevCheckpointProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => children,
  AgentKitDevCheckpointRestore: () => null,
  useOptionalAgentKitHistory: () => null,
}));

vi.mock("./agentkit-chat/index.js", async () => {
  const { ComposerRuntimeAdaptersProvider } =
    await import("../../composer/runtime-adapters.js");
  return {
    CoreComposerRuntimeProvider: ({
      children,
    }: {
      children: React.ReactNode;
    }) =>
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
    createAgentNativeAgentKitTransport: (
      options: NonNullable<typeof mocks.transportOptions>,
    ) => {
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
    AgentKitHistoryProvider: ({ children }: { children: React.ReactNode }) =>
      children,
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
  const upload = mocks.rootProps?.clientOptions?.upload;
  const createUpload = mocks.transportOptions?.operations.createUpload;
  if (!upload || !createUpload) throw new Error("Upload was not configured");
  mocks.uploadFiles.mockImplementationOnce(async (files) => {
    const file = files[0];
    await upload(
      await createUpload({
        threadId: "test-thread",
        descriptor: {
          name: file.name,
          mediaType: file.mediaType,
          size: file.size,
          purpose: "message",
        },
      }),
      file,
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
