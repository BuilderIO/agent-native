import {
  createAgentThreadState,
  type AgentThreadState,
} from "@agent-native/agentkit";
import type { AgentEvent, AgentMessage } from "@agent-native/agentkit/protocol";
import { describe, expect, it, vi } from "vitest";

const getSessionTokenMock = vi.hoisted(() => vi.fn());
const expoFetchMock = vi.hoisted(() => vi.fn());

vi.mock("expo/fetch", () => ({ fetch: expoFetchMock }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/lib/session-token-store", () => ({
  getSessionToken: getSessionTokenMock,
}));
vi.mock("@/lib/analytics", () => ({
  getMobileAnalyticsHeaders: vi.fn(async () => ({})),
}));

import {
  agentKitThreadToMobileHistory,
  agentKitThreadToMobileMessages,
  agentKitThreadToMobileTurnState,
  MOBILE_CHAT_METADATA,
  createMobileAgentKitSession,
  mobileAgentKitEventToWireEvent,
  mobileAttachmentsToAgentKitFiles,
  uploadMobileChatAttachments,
} from "./agentkit-mobile";
import { AgentChatError, parseMobileChatEligibility } from "./api";
import type { ChatAttachment } from "./types";
import {
  canShowMobileVersionHistory,
  mobileVersionHistoryListRequest,
  normalizeMobileChatVersions,
} from "./version-history";

function createThread(messages: AgentMessage[] = []): AgentThreadState {
  return { ...createAgentThreadState("thread-1"), messages };
}

describe("mobile AgentKit adapter", () => {
  it("routes native widget actions through the app action surface", async () => {
    getSessionTokenMock.mockResolvedValue("test-session-token");
    const jsonFetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", jsonFetchMock);
    const session = createMobileAgentKitSession({
      baseUrl: "https://app.example.test",
      settings: {},
    });

    try {
      const result = await session.client.invokeAction({
        id: "invocation-1",
        action: "accept-change",
        threadId: "thread-1",
        widgetId: "widget-1",
        payload: { changeId: "change-1" },
      });

      expect(result).toMatchObject({
        invocationId: "invocation-1",
        status: "completed",
        data: { accepted: true },
      });
      expect(jsonFetchMock).toHaveBeenCalledWith(
        "https://app.example.test/_agent-native/actions/accept-change",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ changeId: "change-1" }),
        }),
      );
    } finally {
      await session.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("requires the strict chatEligible status field", () => {
    expect(parseMobileChatEligibility({ chatEligible: true })).toBe(true);
    expect(parseMobileChatEligibility({ chatEligible: false })).toBe(false);
    expect(() =>
      parseMobileChatEligibility({ configured: true, hasApiKey: true }),
    ).toThrow("Chat setup status could not be confirmed.");
  });

  it("treats setup-forbidden responses separately from expired sessions", () => {
    expect(new AgentChatError("Connect an AI provider", 403).authRequired).toBe(
      false,
    );
    expect(new AgentChatError("Sign in", 401).authRequired).toBe(true);
  });

  it("uses the canonical AgentKit transport for mobile chat runs", async () => {
    getSessionTokenMock.mockResolvedValue("test-session-token");
    const responseBody =
      '{"type":"text","text":"Hello from AgentKit"}\n' + '{"type":"done"}\n';
    expoFetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/threads/")) return new Response(null, { status: 404 });
      return new Response(responseBody, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
          "X-Run-Id": "run-1",
        },
      });
    });
    const session = createMobileAgentKitSession({
      baseUrl: "https://app.example.test",
      settings: { engine: "openai", mode: "plan" },
      scope: { type: "deck", id: "deck-1" },
    });
    const observedEvents = new Set<string>();
    const unsubscribe = session.client.subscribe(() => {
      for (const event of session.client.getThread("thread-1").events) {
        observedEvents.add(event.type);
      }
    });

    try {
      const run = await session.client.sendMessage({
        threadId: "thread-1",
        text: "Say hello",
        options: { model: "gpt-4.1", reasoningEffort: "high" },
        metadata: {
          chatScope: { type: "deck", id: "deck-1" },
          [MOBILE_CHAT_METADATA]: { turnId: "turn-1" },
        },
      });
      await run.completed;

      expect(expoFetchMock).toHaveBeenCalledWith(
        "https://app.example.test/_agent-native/agent-chat",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"message":"Say hello"'),
        }),
      );
      expect(
        expoFetchMock.mock.calls.some(([url]) =>
          String(url).includes("/runs/"),
        ),
      ).toBe(false);
      expect(observedEvents).toContain("message.delta");
    } finally {
      unsubscribe();
      await session.dispose();
    }
  });

  it("maps setup failures to the friendly native recovery state", () => {
    const event: AgentEvent = {
      type: "run.failed",
      id: "event-1",
      threadId: "thread-1",
      runId: "run-1",
      sequence: 1,
      occurredAt: "2026-09-25T12:00:00.000Z",
      error: {
        code: "AGENT_CHAT_AI_SETUP_REQUIRED",
        message: "Connect an AI provider before chatting.",
      },
    };
    expect(mobileAgentKitEventToWireEvent(event)).toMatchObject({
      type: "error",
      errorCode: "missing_api_key",
      error: "Error: Connect an AI provider before chatting.",
    });
  });

  it("formats failed provider runs with Core's shared chat error copy", () => {
    const event: AgentEvent = {
      type: "run.failed",
      id: "event-1",
      threadId: "thread-1",
      runId: "run-1",
      sequence: 1,
      occurredAt: "2026-09-25T12:00:00.000Z",
      error: {
        code: "builder_auth_error",
        message: "Provider rejected token secret-token-123.",
      },
    };

    expect(mobileAgentKitEventToWireEvent(event)).toMatchObject({
      type: "error",
      errorCode: "builder_auth_error",
      error:
        "Error: Builder rejected the connected credentials. Reconnect Builder.io (free tier available) in Settings, then retry.",
    });
    expect(mobileAgentKitEventToWireEvent(event)?.error).not.toContain(
      "secret-token-123",
    );
  });

  it("maps typed approval events back to the native transcript projection", () => {
    const event: AgentEvent = {
      type: "approval.requested",
      id: "event-1",
      threadId: "thread-1",
      runId: "run-1",
      sequence: 1,
      occurredAt: "2026-09-25T12:00:00.000Z",
      request: {
        id: "approval-1",
        title: "Update the design",
        metadata: {
          toolCallId: "tool-call-1",
          toolName: "update_design",
          input: { color: "blue" },
        },
      },
    };

    expect(mobileAgentKitEventToWireEvent(event)).toMatchObject({
      type: "approval_required",
      id: "approval-1",
      approvalKey: "approval-1",
      toolCallId: "tool-call-1",
      tool: "update_design",
      input: { color: "blue" },
    });
  });

  it("keeps connection requests and safe widget data in the native transcript", () => {
    const connection: AgentEvent = {
      type: "connection.requested",
      id: "event-connection-1",
      threadId: "thread-1",
      runId: "run-1",
      sequence: 1,
      occurredAt: "2026-09-25T12:00:00.000Z",
      request: {
        id: "connection-1",
        provider: "Granola",
        reason: "connect",
        status: "requested",
        detail: "Connect Granola to search your notes.",
      },
    };
    expect(mobileAgentKitEventToWireEvent(connection)).toMatchObject({
      type: "connection_required",
      id: "connection-1",
      provider: "Granola",
      status: "requested",
    });

    const toolResult: AgentEvent = {
      type: "tool.updated",
      id: "event-tool-1",
      threadId: "thread-1",
      runId: "run-1",
      sequence: 2,
      occurredAt: "2026-09-25T12:00:01.000Z",
      toolCall: {
        id: "tool-1",
        name: "search_notes",
        output: "Search result",
        status: "completed",
        metadata: {
          completedSideEffect: true,
          mcpApp: { resource: { title: "Search result" } },
          chatUI: { renderer: "core.inline-extension" },
        },
      },
    };
    expect(mobileAgentKitEventToWireEvent(toolResult)).toMatchObject({
      type: "tool_done",
      completedSideEffect: true,
      mcpApp: { resource: { title: "Search result" } },
      chatUI: { renderer: "core.inline-extension" },
    });

    const thread = createThread([
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: "2026-09-25T12:00:01.000Z",
        metadata: { chatScope: { type: "deck", id: "deck-1" } },
        parts: [
          {
            type: "data",
            data: {
              kind: "agent-native/connection-required",
              provider: "Granola",
              reason: "connect",
            },
          },
          {
            type: "widget",
            widget: {
              id: "widget-1",
              kind: "notice",
              title: "Review this update",
              data: { message: "Check the selected changes." },
              actions: [
                { id: "accept", action: "accept-change", label: "Accept" },
              ],
            },
          },
          {
            type: "data",
            mediaType: "application/x-agent-native-repository-part",
            data: {
              type: "tool-call",
              toolCallId: "tool-1",
              toolName: "update-deck",
              completedSideEffect: true,
            },
          },
        ],
      },
    ]);
    const [message] = agentKitThreadToMobileMessages(thread);
    expect(message?.parts).toMatchObject([
      { type: "connection-request", provider: "Granola" },
      {
        type: "widget",
        widget: { id: "widget-1", actions: [{ action: "accept-change" }] },
      },
      { type: "tool-call", completedSideEffect: true },
    ]);
    expect(message && canShowMobileVersionHistory(message)).toBe(true);
    expect(
      mobileVersionHistoryListRequest(
        { type: "deck", id: "deck-1" },
        "thread-1",
      ),
    ).toEqual({
      action: "list-deck-versions",
      args: { deckId: "deck-1", limit: 100, threadId: "thread-1" },
    });
  });

  it("normalizes only well-formed native history rows and labels chat start", () => {
    expect(
      normalizeMobileChatVersions({
        versions: [
          {
            id: "start-1",
            title: "Initial version",
            createdAt: "2026-09-25T10:00:00.000Z",
            chatContext: { phase: "start" },
          },
          { id: "bad-date", createdAt: "not a date" },
          { title: "missing id", createdAt: "2026-09-25T10:00:00.000Z" },
        ],
      }),
    ).toEqual([
      {
        id: "start-1",
        label: "Initial version",
        createdAt: "2026-09-25T10:00:00.000Z",
        editable: true,
        isBeginning: true,
      },
    ]);
  });

  it("requires attachments to be uploaded before creating AgentKit file parts", () => {
    expect(() =>
      mobileAttachmentsToAgentKitFiles([
        {
          type: "image",
          name: "photo.jpg",
          data: "data:image/jpeg;base64,ZmFrZQ==",
          contentType: "image/jpeg",
        },
      ]),
    ).toThrow("must be uploaded before it can be sent");
    expect(() =>
      mobileAttachmentsToAgentKitFiles([
        { type: "file", name: "notes.txt", text: "hello" },
      ]),
    ).toThrow("must be uploaded before it can be sent");
    expect(
      mobileAttachmentsToAgentKitFiles([
        {
          type: "image",
          name: "photo.jpg",
          url: "https://files.example.test/photo.jpg",
          contentType: "image/jpeg",
        },
      ]),
    ).toEqual([
      {
        type: "file",
        name: "photo.jpg",
        mediaType: "image/jpeg",
        url: "https://files.example.test/photo.jpg",
      },
    ]);
  });

  it("uploads staged attachments before they enter AgentKit messages or requests", async () => {
    getSessionTokenMock.mockResolvedValue("test-session-token");
    expoFetchMock.mockClear();
    const responseBody = '{"type":"done"}\n';
    expoFetchMock.mockImplementation(
      async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/_agent-native/file-upload")) {
          const file = (init?.body as FormData).get("file") as File;
          return Response.json(
            {
              url: `https://files.example.test/${file.name}`,
              id: `stored-${file.name}`,
            },
            { status: 201 },
          );
        }
        return new Response(responseBody, {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        });
      },
    );
    const session = createMobileAgentKitSession({
      baseUrl: "https://app.example.test",
      settings: {},
    });
    const staged: ChatAttachment[] = [
      {
        type: "image",
        name: "photo.jpg",
        contentType: "image/jpeg",
        data: "data:image/jpeg;base64,ZmFrZQ==",
      },
      {
        type: "file",
        name: "report.pdf",
        contentType: "application/pdf",
        data: "data:application/pdf;base64,JVBERi0x",
      },
      { type: "file", name: "notes.txt", text: "private notes" },
    ];

    try {
      const uploaded = await uploadMobileChatAttachments(
        session.client,
        "thread-1",
        staged,
      );
      const files = mobileAttachmentsToAgentKitFiles(uploaded);
      const run = await session.client.sendMessage({
        threadId: "thread-1",
        text: "Review these attachments",
        attachments: files,
      });
      await run.completed;

      const uploadCalls = expoFetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/_agent-native/file-upload"),
      );
      const uploadedFile = (index: number) =>
        (uploadCalls[index]![1]?.body as FormData).get("file") as File;
      expect(uploadCalls).toHaveLength(3);
      await expect(uploadedFile(0).text()).resolves.toBe("fake");
      await expect(uploadedFile(1).text()).resolves.toBe("%PDF-1");
      await expect(uploadedFile(2).text()).resolves.toBe("private notes");

      expect(uploaded).toEqual([
        {
          type: "image",
          name: "photo.jpg",
          contentType: "image/jpeg",
          url: "https://files.example.test/photo.jpg",
        },
        {
          type: "file",
          name: "report.pdf",
          contentType: "application/pdf",
          url: "https://files.example.test/report.pdf",
        },
        {
          type: "file",
          name: "notes.txt",
          url: "https://files.example.test/notes.txt",
        },
      ]);
      expect(staged[0]?.data).toBe("data:image/jpeg;base64,ZmFrZQ==");

      const agentKitMessages = session.client.getThread("thread-1").messages;
      const durableUserMessage = [...agentKitMessages]
        .reverse()
        .find((message) => message.role === "user");
      expect(durableUserMessage?.parts).toContainEqual({
        type: "file",
        name: "photo.jpg",
        mediaType: "image/jpeg",
        url: "https://files.example.test/photo.jpg",
      });
      const chatRequest = expoFetchMock.mock.calls.find(([url]) =>
        String(url).endsWith("/_agent-native/agent-chat"),
      );
      expect(chatRequest).toBeDefined();
      const requestBody = String(chatRequest?.[1]?.body);
      expect(requestBody).toContain("https://files.example.test/photo.jpg");
      expect(requestBody).not.toMatch(/data:|ZmFrZQ==|JVBERi0x|private notes/);
      expect(JSON.stringify(agentKitMessages)).not.toMatch(
        /data:|ZmFrZQ==|JVBERi0x|private notes/,
      );
    } finally {
      await session.dispose();
      expoFetchMock.mockReset();
    }
  });

  it("surfaces storage setup guidance and does not send the message when upload fails", async () => {
    getSessionTokenMock.mockResolvedValue("test-session-token");
    expoFetchMock.mockClear();
    const guidance =
      "No object storage is connected. Connect Builder.io or add S3-compatible storage in Settings → File uploads.";
    expoFetchMock.mockResolvedValue(
      Response.json({ error: guidance }, { status: 503 }),
    );
    const session = createMobileAgentKitSession({
      baseUrl: "https://app.example.test",
      settings: {},
    });

    try {
      await expect(
        uploadMobileChatAttachments(session.client, "thread-1", [
          {
            type: "image",
            name: "photo.jpg",
            contentType: "image/jpeg",
            data: "data:image/jpeg;base64,ZmFrZQ==",
          },
        ]),
      ).rejects.toThrow(guidance);
      expect(session.client.getThread("thread-1").messages).toEqual([]);
      expect(
        expoFetchMock.mock.calls.some(([url]) =>
          String(url).endsWith("/_agent-native/agent-chat"),
        ),
      ).toBe(false);
    } finally {
      await session.dispose();
      expoFetchMock.mockReset();
    }
  });

  it("projects durable typed messages and history into the mobile chat model", () => {
    const thread = createThread([
      {
        id: "user-1",
        role: "user",
        createdAt: "2026-09-25T12:00:00.000Z",
        parts: [{ type: "text", text: "Make it blue" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: "2026-09-25T12:00:01.000Z",
        parts: [
          { type: "reasoning", text: "Inspecting the design" },
          { type: "text", text: "I updated the design." },
        ],
      },
    ]);

    expect(agentKitThreadToMobileHistory(thread)).toEqual([
      { role: "user", content: "Make it blue" },
      { role: "assistant", content: "I updated the design." },
    ]);
    expect(agentKitThreadToMobileMessages(thread)).toMatchObject([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Make it blue" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "Inspecting the design" },
          { type: "text", text: "I updated the design." },
        ],
      },
    ]);
  });

  it("uses AgentKit run snapshots to resume an active mobile thread", () => {
    const thread: AgentThreadState = {
      ...createThread(),
      activeRunIds: ["run-1"],
      runs: {
        "run-1": {
          id: "run-1",
          status: "running",
          lastSequence: 3,
        },
      },
    };

    expect(agentKitThreadToMobileTurnState(thread)).toMatchObject({
      isStreaming: true,
      runId: "run-1",
      error: null,
    });
  });

  it.each(["awaiting_approval", "awaiting_input"] as const)(
    "restores mobile turn state for %s runs",
    (status) => {
      const thread: AgentThreadState = {
        ...createThread(),
        activeRunIds: ["run-1"],
        runs: {
          "run-1": {
            id: "run-1",
            status,
            lastSequence: 3,
          },
        },
      };

      expect(agentKitThreadToMobileTurnState(thread)).toMatchObject({
        isStreaming: true,
        runId: "run-1",
      });
    },
  );

  it("formats failed run snapshots with the shared chat error copy", () => {
    const thread: AgentThreadState = {
      ...createThread(),
      activeRunIds: [],
      runs: {
        "run-1": {
          id: "run-1",
          status: "failed",
          lastSequence: 1,
          error: {
            code: "builder_auth_error",
            message: "Provider rejected token secret-token-123.",
          },
        },
      },
    };

    expect(agentKitThreadToMobileTurnState(thread)).toMatchObject({
      error:
        "Error: Builder rejected the connected credentials. Reconnect Builder.io (free tier available) in Settings, then retry.",
      errorCode: "builder_auth_error",
    });
  });
});
