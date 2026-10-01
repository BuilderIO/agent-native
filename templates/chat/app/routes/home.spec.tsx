// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  basePath: "",
  threadId: undefined as string | undefined,
  messages: [] as Array<{
    id: string;
    role?: string;
    parts?: Array<
      | { type: "text"; text: string }
      | {
          type: "file";
          name: string;
          url?: string;
          fileId?: string;
          mediaType?: string;
        }
    >;
    metadata?: unknown;
  }>,
  title: undefined as string | undefined,
  navigate: vi.fn(),
  transport: undefined as
    | { id: string; dispose: ReturnType<typeof vi.fn> }
    | undefined,
  transports: [] as Array<{
    id: string;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  rootProps: null as Record<string, unknown> | null,
  chatProps: null as Record<string, unknown> | null,
  connectionRequestProps: null as Record<string, unknown> | null,
  resumeProps: null as Record<string, unknown> | null,
  resolveConnectionRequest: vi.fn(),
  sendMessage: vi.fn(),
}));

const createTransport = vi.hoisted(() =>
  vi.fn(() => {
    const transport = {
      id: `agent-native-agentkit-${routeState.transports.length + 1}`,
      dispose: vi.fn(),
    };
    routeState.transport = transport;
    routeState.transports.push(transport);
    return transport;
  }),
);
const markHandoff = vi.hoisted(() => vi.fn());
const trackEvent = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/toolkit/app/chat/agentkit-chat/rail", () => ({
  markAgentChatHomeHandoff: markHandoff,
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (path: string) => `${routeState.basePath}${path}`,
  agentNativePath: (path: string) => `${routeState.basePath}${path}`,
}));
vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));

vi.mock("@agent-native/toolkit/app/chat/agentkit-chat/composer", () => ({
  CoreComposerRuntimeProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-core-composer-runtime="">{children}</div>,
}));
vi.mock("@agent-native/toolkit/app/chat/agentkit-chat/index", () => ({
  CoreAgentKitRoot: (props: Record<string, unknown>) => {
    routeState.rootProps = props;
    return <>{props.children as React.ReactNode}</>;
  },
}));
vi.mock("@agent-native/toolkit/app/chat/agentkit-chat/connections", () => ({
  McpAgentKitConnectionRequestCard: (props: Record<string, unknown>) => {
    routeState.connectionRequestProps = props;
    return null;
  },
  McpAgentKitConnectionResume: (props: Record<string, unknown>) => {
    routeState.resumeProps = props;
    return null;
  },
}));
vi.mock("@agent-native/toolkit/app/chat/agentkit-chat/questions", () => ({
  GuidedQuestionFlow: () => null,
  useGuidedQuestionFlow: () => ({
    questions: null,
    handleSubmit: vi.fn(),
    handleSkip: vi.fn(),
  }),
}));
vi.mock("@agent-native/toolkit/app/chat/agentkit-chat/suggestions", () => ({
  findMcpConnectionSuggestionIntegration: () => null,
  McpConnectionSuggestion: () => null,
}));
vi.mock("@agent-native/core/client/agentkit-chat/transport", () => ({
  createAgentNativeAgentKitTransport: createTransport,
}));

vi.mock("@agent-native/toolkit/app/agentkit/react/components", () => ({
  AgentMessageView: ({ value }: { value: { id: string } }) => (
    <div data-testid="rendered-agent-message">{value.id}</div>
  ),
  AgentRunFailure: ({ error }: { error: { message: string } }) => (
    <div data-testid="generic-run-failure">{error.message}</div>
  ),
  AgentConnectionRequestCard: () => null,
  AgentKitChat: (props: Record<string, unknown>) => {
    routeState.chatProps = props;
    return (
      <div data-agentkit-chat="">
        {routeState.messages.length > 0
          ? (props.toolbar as React.ReactNode)
          : null}
      </div>
    );
  },
}));
vi.mock("@agent-native/toolkit/app/chat/chat/run-recovery", () => ({
  BuilderSetupCard: ({
    onConnected,
    onRetry,
  }: {
    onConnected?: () => void;
    onRetry?: () => void;
  }) => (
    <div data-testid="chat-builder-setup">
      {onConnected ? (
        <button data-testid="chat-builder-connected" onClick={onConnected} />
      ) : null}
      {onRetry ? (
        <button data-testid="chat-builder-setup-retry" onClick={onRetry} />
      ) : null}
    </div>
  ),
  isMissingLlmProviderRunError: ({
    errorCode,
    details,
  }: {
    errorCode?: string;
    details?: string;
  }) =>
    errorCode === "missing_credentials" ||
    /No LLM provider key was found/i.test(details ?? ""),
}));
vi.mock("@agent-native/toolkit/app/agentkit/react/context", () => ({
  useAgentKit: () => ({
    threadId: routeState.threadId ?? "new-thread",
    controller: {
      resolveConnectionRequest: routeState.resolveConnectionRequest,
      sendMessage: routeState.sendMessage,
    },
  }),
  useAgentKitControl: () => ({
    resolveConnectionRequest: routeState.resolveConnectionRequest,
  }),
  useAgentThread: () => ({
    messages: routeState.messages,
    thread: routeState.title ? { title: routeState.title } : undefined,
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("react-router", () => ({
  useNavigate: () => routeState.navigate,
  useParams: () => ({ threadId: routeState.threadId }),
}));

vi.mock("@/lib/app-config", () => ({ APP_TITLE: "Chat" }));
vi.mock("@/lib/tab-id", () => ({ TAB_ID: "chat-tab" }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

import ChatRoute from "@/components/chat/ChatRouteContent";

import ChatHomeRoute from "./home";

describe("ChatRoute AgentKit surface", () => {
  let container: HTMLDivElement;
  let root: Root;
  let locationReplace: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    routeState.basePath = "";
    routeState.threadId = undefined;
    routeState.messages = [];
    routeState.title = undefined;
    routeState.navigate.mockReset();
    routeState.transport = undefined;
    routeState.transports = [];
    routeState.rootProps = null;
    routeState.chatProps = null;
    routeState.connectionRequestProps = null;
    routeState.resumeProps = null;
    routeState.resolveConnectionRequest.mockReset();
    routeState.sendMessage.mockReset();
    createTransport.mockClear();
    markHandoff.mockClear();
    trackEvent.mockClear();
    window.sessionStorage.clear();
    locationReplace = vi
      .spyOn(window.location, "replace")
      .mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    locationReplace.mockRestore();
    vi.unstubAllGlobals();
  });

  it("mounts the real Agent-Native transport into AgentKit", () => {
    routeState.threadId = "thread-one";
    act(() => root.render(<ChatRoute />));

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        browserTabId: "chat-tab",
        surface: "app",
        adapter: { textFormat: "markdown" },
      }),
    );
    expect(routeState.rootProps).toMatchObject({
      transport: routeState.transport,
      clientOptions: {
        transportOwnership: "owned",
        retainActiveRunsOnThreadRelease: true,
      },
      labels: { composerPlaceholder: "chat.composerPlaceholder" },
      slots: {
        emptyState: expect.any(Function),
        message: expect.any(Function),
        messageSupplement: expect.any(Function),
        runFailure: expect.any(Function),
        connectionRequest: expect.any(Function),
        footer: expect.any(Function),
      },
    });
    expect(routeState.rootProps?.slots).not.toHaveProperty("text");
    expect(routeState.chatProps).toMatchObject({
      title: "Chat",
      emptyComposerPlacement: "center",
      composerProps: {
        queueWhileRunning: true,
        autoFocus: true,
        plusMenuMode: "full",
        voiceEnabled: true,
        includeDefaultSlashCommands: false,
        includeDefaultSlashSkills: false,
      },
    });
    expect(
      container.querySelector("[data-core-composer-runtime]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-agent-page-workspace-toggle]"),
    ).toBeNull();
  });

  it("passes connection request scope to the MCP connection card", () => {
    routeState.threadId = "thread-one";
    act(() => root.render(<ChatRoute />));

    const slots = routeState.rootProps?.slots as {
      connectionRequest: React.ComponentType<{
        value: {
          id: string;
          provider: string;
          reason: "grant";
          status: "requested";
          appId: string;
          source: { id: string; kind: string; label: string };
        };
        runId: string;
      }>;
    };
    const source = {
      id: "salesforce",
      kind: "workspace_connection",
      label: "Salesforce",
    };
    act(() =>
      root.render(
        React.createElement(slots.connectionRequest, {
          value: {
            id: "request-one",
            provider: "salesforce",
            reason: "grant",
            status: "requested",
            appId: "chat",
            source,
          },
          runId: "run-one",
        }),
      ),
    );

    expect(routeState.connectionRequestProps).toMatchObject({
      reason: "grant",
      appId: "chat",
      source,
    });
  });

  it("keeps failed connection resolution retryable", async () => {
    routeState.threadId = "thread-one";
    const error = new Error("Connection request could not be resolved.");
    routeState.resolveConnectionRequest.mockRejectedValueOnce(error);
    await act(async () => root.render(<ChatRoute />));

    const resumeProps = routeState.resumeProps as {
      onResume: (
        target: { threadId: string; runId: string; requestId: string },
        request: { message: string },
      ) => Promise<void>;
    };
    await expect(
      resumeProps.onResume(
        { threadId: "thread-one", runId: "run-one", requestId: "req-one" },
        { message: "Continue after connecting." },
      ),
    ).rejects.toBe(error);
    expect(routeState.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps the empty chat state to its heading", () => {
    routeState.threadId = "thread-one";
    act(() => root.render(<ChatRoute />));

    const slots = routeState.rootProps?.slots as {
      emptyState: React.ComponentType;
    };
    act(() => root.render(React.createElement(slots.emptyState)));

    expect(container.querySelector("h1")?.textContent).toBe("chat.heroTitle");
    expect(container.querySelector("p")).toBeNull();
  });

  it("shows Builder setup only for a missing key on the first user message", () => {
    routeState.threadId = "thread-one";
    routeState.messages = [{ id: "user-1", role: "user" }];
    act(() => root.render(<ChatRoute />));

    const slots = routeState.rootProps?.slots as {
      runFailure: React.ComponentType<{
        error: { code: string; message: string; details?: unknown };
        runId: string;
        threadId: string;
      }>;
    };
    const failure = slots.runFailure;
    const failureProps = {
      error: { code: "missing_credentials", message: "Missing credentials" },
      runId: "run-one",
      threadId: "thread-one",
    };
    act(() => root.render(React.createElement(failure, failureProps)));
    expect(
      container.querySelector("[data-testid='chat-builder-setup']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='generic-run-failure']"),
    ).toBeNull();

    routeState.messages = [
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant" },
      { id: "user-2", role: "user" },
    ];
    act(() => root.render(React.createElement(failure, failureProps)));
    expect(
      container.querySelector("[data-testid='chat-builder-setup']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='generic-run-failure']"),
    ).not.toBeNull();
  });

  it("detects missing provider details and retries the original turn once", () => {
    routeState.threadId = "thread-one";
    routeState.messages = [
      {
        id: "user-1",
        role: "user",
        parts: [
          { type: "text", text: "Summarize this file" },
          {
            type: "file",
            name: "brief.pdf",
            url: "/uploads/brief.pdf",
            mediaType: "application/pdf",
          },
        ],
      },
    ];
    act(() => root.render(<ChatRoute />));

    const slots = routeState.rootProps?.slots as {
      runFailure: React.ComponentType<{
        error: { code: string; message: string; details?: unknown };
        runId: string;
        threadId: string;
      }>;
    };
    const failure = slots.runFailure;
    act(() =>
      root.render(
        React.createElement(failure, {
          error: {
            code: "provider_error",
            message: "The request could not be processed.",
            details: "No LLM provider key was found.",
          },
          runId: "run-one",
          threadId: "thread-one",
        }),
      ),
    );

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          "[data-testid='chat-builder-setup-retry']",
        )
        ?.click(),
    );

    expect(routeState.sendMessage).toHaveBeenCalledOnce();
    expect(routeState.sendMessage.mock.calls[0]?.[0]).toEqual({
      threadId: "thread-one",
      text: "Summarize this file",
      attachments: [
        {
          type: "file",
          name: "brief.pdf",
          url: "/uploads/brief.pdf",
          mediaType: "application/pdf",
        },
      ],
      metadata: {
        custom: {
          agentNativeRecoveryAction: "retry",
          agentNativeRecoveryOfRunId: "run-one",
        },
      },
    });

    const messageSlot = (
      routeState.rootProps?.slots as {
        message: React.ComponentType<{
          value: { id: string; role: string; metadata?: unknown };
          threadId: string;
        }>;
      }
    ).message;
    act(() =>
      root.render(
        React.createElement(messageSlot, {
          value: {
            id: "recovery-1",
            role: "user",
            metadata: {
              custom: { agentNativeRecoveryAction: "retry" },
            },
          },
          threadId: "thread-one",
        }),
      ),
    );
    expect(
      container.querySelector("[data-testid='rendered-agent-message']"),
    ).toBeNull();
    act(() =>
      root.render(
        React.createElement(messageSlot, {
          value: { id: "user-1", role: "user" },
          threadId: "thread-one",
        }),
      ),
    );
    expect(
      container.querySelector("[data-testid='rendered-agent-message']"),
    ).not.toBeNull();

    routeState.messages.push({
      id: "recovery-1",
      role: "user",
      parts: [{ type: "text", text: "Summarize this file" }],
      metadata: {
        custom: {
          agentNativeRecoveryAction: "retry",
          agentNativeRecoveryOfRunId: "run-one",
        },
      },
    });
    act(() =>
      root.render(
        React.createElement(failure, {
          error: {
            code: "provider_error",
            message: "The request could not be processed.",
            details: "No LLM provider key was found.",
          },
          runId: "run-two",
          threadId: "thread-one",
        }),
      ),
    );

    expect(
      container.querySelector("[data-testid='chat-builder-setup']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='generic-run-failure']"),
    ).toBeNull();

    act(() =>
      root.render(
        React.createElement(failure, {
          error: {
            code: "provider_error",
            message: "The request could not be processed.",
            details: "No LLM provider key was found.",
          },
          runId: "run-one",
          threadId: "thread-one",
        }),
      ),
    );

    expect(
      container.querySelector("[data-testid='chat-builder-setup']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='generic-run-failure']"),
    ).not.toBeNull();
  });

  it("retries after Builder connects and ignores a racing manual retry", () => {
    routeState.threadId = "thread-one";
    routeState.messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Draft a launch plan" }],
      },
    ];
    act(() => root.render(<ChatRoute />));

    const slots = routeState.rootProps?.slots as {
      runFailure: React.ComponentType<{
        error: { code: string; message: string; details?: unknown };
        runId: string;
        threadId: string;
      }>;
    };
    act(() =>
      root.render(
        React.createElement(slots.runFailure, {
          error: {
            code: "missing_credentials",
            message: "Missing credentials",
          },
          runId: "run-one",
          threadId: "thread-one",
        }),
      ),
    );

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          "[data-testid='chat-builder-connected']",
        )
        ?.click();
      container
        .querySelector<HTMLButtonElement>(
          "[data-testid='chat-builder-setup-retry']",
        )
        ?.click();
    });

    expect(routeState.sendMessage).toHaveBeenCalledOnce();
    expect(routeState.sendMessage.mock.calls[0]?.[0]).toEqual({
      threadId: "thread-one",
      text: "Draft a launch plan",
      metadata: {
        custom: {
          agentNativeRecoveryAction: "retry",
          agentNativeRecoveryOfRunId: "run-one",
        },
      },
    });
  });

  it("does not retry a file-ID-only attachment and shows a typed error", () => {
    routeState.threadId = "thread-one";
    routeState.messages = [
      {
        id: "user-1",
        role: "user",
        parts: [
          { type: "text", text: "Summarize this file" },
          { type: "file", name: "brief.pdf", fileId: "file-1" },
        ],
      },
    ];
    act(() => root.render(<ChatRoute />));

    const slots = routeState.rootProps?.slots as {
      runFailure: React.ComponentType<{
        error: { code: string; message: string; details?: unknown };
        runId: string;
        threadId: string;
      }>;
    };
    const failure = slots.runFailure;
    act(() =>
      root.render(
        React.createElement(failure, {
          error: {
            code: "missing_credentials",
            message: "Missing credentials",
          },
          runId: "run-one",
          threadId: "thread-one",
        }),
      ),
    );

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          "[data-testid='chat-builder-connected']",
        )
        ?.click(),
    );

    expect(routeState.sendMessage).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "chat.retryAttachmentUnavailable",
    );
  });

  it("keeps one owned transport across routed threads", () => {
    routeState.threadId = "thread-one";
    act(() => root.render(<ChatRoute />));
    const firstTransport = routeState.transport;

    routeState.threadId = "thread-two";
    act(() => root.render(<ChatRoute />));
    const secondTransport = routeState.transport;

    expect(secondTransport).toBe(firstTransport);
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(routeState.rootProps).toMatchObject({
      transport: secondTransport,
      clientOptions: {
        transportOwnership: "owned",
        retainActiveRunsOnThreadRelease: true,
      },
    });
  });

  it("hard-navigates the home route to a durable pending thread", async () => {
    await act(async () => root.render(<ChatHomeRoute />));

    expect(createTransport).not.toHaveBeenCalled();
    expect(routeState.rootProps).toBeNull();
    expect(locationReplace).toHaveBeenCalledWith(
      expect.stringMatching(/^\/chat\/chat-/),
    );
    expect(markHandoff).toHaveBeenCalledWith("chat");
  });

  it("keeps the home handoff inside the deployed app base path", async () => {
    routeState.basePath = "/chatapp";
    await act(async () => root.render(<ChatHomeRoute />));
    expect(locationReplace).toHaveBeenCalledWith(
      expect.stringMatching(/^\/chatapp\/chat\/chat-/),
    );
  });

  it("starts the handoff only once under Strict Mode", async () => {
    await act(async () =>
      root.render(
        <React.StrictMode>
          <ChatHomeRoute />
        </React.StrictMode>,
      ),
    );

    expect(locationReplace).toHaveBeenCalledTimes(1);
    expect(markHandoff).toHaveBeenCalledTimes(1);
  });

  it("enters durable chat mode and exposes the workspace toolbar", () => {
    routeState.threadId = "thread-one";
    routeState.messages = [{ id: "user-1" }];
    routeState.title = "Release review";

    act(() => root.render(<ChatRoute />));

    const toggle = container.querySelector<HTMLButtonElement>(
      "[data-agent-page-workspace-toggle]",
    );
    const panel = container.querySelector<HTMLElement>(
      "[data-agent-chat-workspace-panel]",
    );
    expect(routeState.chatProps?.title).toBe("Release review");
    expect(toggle).not.toBeNull();
    expect(panel?.dataset.state).toBe("closed");
    expect(markHandoff).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledWith("thread_resumed", {
      thread_id: "thread-one",
    });

    act(() => toggle?.click());
    expect(panel?.dataset.state).toBe("open");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  });

  it("attributes a pending home handoff as a created thread", () => {
    routeState.threadId = "chat-new";
    window.sessionStorage.setItem(
      "agent-native.chat-home-thread",
      JSON.stringify({ id: "chat-new", issuedAt: Date.now() }),
    );

    act(() => root.render(<ChatRoute />));
    expect(trackEvent).not.toHaveBeenCalledWith(
      "thread_resumed",
      expect.anything(),
    );

    routeState.messages = [{ id: "user-1" }];
    act(() => root.render(<ChatRoute />));

    expect(trackEvent).toHaveBeenCalledWith("thread_created", {
      output_id: "chat-new",
      output_type: "thread",
    });
    expect(trackEvent).toHaveBeenCalledWith("message_exchanged", {
      thread_id: "chat-new",
      msg_count: 1,
    });
  });

  it("keeps the full-page Chat route as a flat canvas", () => {
    const layoutSource = readFileSync(
      "app/components/layout/Layout.tsx",
      "utf8",
    );

    expect(layoutSource).toContain('data-agent-chat-canvas="true"');
  });
});
