import { describe, expect, it, vi } from "vitest";
import type {
  IncomingMessage,
  PlatformAdapter,
} from "@agent-native/core/server";
import {
  handleRemoteCodeCommand,
  parseTelegramCodeCommand,
  type RemoteCodeCommandEnvelope,
} from "./dispatch-remote-commands.js";

function telegramIncoming(text: string, rawText = text): IncomingMessage {
  return {
    platform: "telegram",
    externalThreadId: "chat-123",
    text,
    senderId: "user-1",
    senderName: "User One",
    platformContext: { chatId: 123, messageId: 456, rawText },
    timestamp: 1710000000000,
  };
}

const adapter = {
  platform: "telegram",
  label: "Telegram",
} as PlatformAdapter;

describe("parseTelegramCodeCommand", () => {
  it("parses a prompt as a create command", () => {
    expect(
      parseTelegramCodeCommand(
        telegramIncoming(
          "fix the failing tests",
          "/code fix the failing tests",
        ),
      ),
    ).toEqual({ type: "create", prompt: "fix the failing tests" });
  });

  it("parses run management commands", () => {
    expect(
      parseTelegramCodeCommand(telegramIncoming("list", "/code list")),
    ).toEqual({
      type: "list",
    });
    expect(
      parseTelegramCodeCommand(telegramIncoming("status 2", "/code status 2")),
    ).toEqual({ type: "status", runRef: "2" });
    expect(
      parseTelegramCodeCommand(
        telegramIncoming(
          "continue run_123 add docs",
          "/code continue run_123 add docs",
        ),
      ),
    ).toEqual({ type: "continue", runRef: "run_123", text: "add docs" });
    expect(
      parseTelegramCodeCommand(
        telegramIncoming("approve req_1", "/code approve req_1"),
      ),
    ).toEqual({ type: "approve", approvalId: "req_1" });
    expect(
      parseTelegramCodeCommand(
        telegramIncoming("deny req_1", "/code deny req_1"),
      ),
    ).toEqual({ type: "deny", approvalId: "req_1" });
    expect(
      parseTelegramCodeCommand(telegramIncoming("stop 1", "/code stop 1")),
    ).toEqual({
      type: "stop",
      runRef: "1",
    });
  });

  it("does not hijack Telegram messages after the adapter strips other commands", () => {
    expect(
      parseTelegramCodeCommand({
        platform: "telegram",
        text: "list",
        platformContext: {},
      }),
    ).toBeNull();
  });
});

describe("handleRemoteCodeCommand", () => {
  it("routes code commands to the remote relay with owner and source context", async () => {
    const relay = vi.fn(async () => ({
      ok: true,
      runId: "run_123",
      hostOnline: true,
    }));

    const result = await handleRemoteCodeCommand(
      telegramIncoming("ship it", "/code ship it"),
      adapter,
      {
        resolveOwner: () => "owner@example.test",
        relay,
      },
    );

    expect(result).toEqual({
      handled: true,
      responseText: "Queued code run (run_123).",
    });
    expect(relay).toHaveBeenCalledWith({
      kind: "code-agent",
      ownerEmail: "owner@example.test",
      command: { type: "create", prompt: "ship it" },
      source: {
        platform: "telegram",
        externalThreadId: "chat-123",
        senderId: "user-1",
        senderName: "User One",
        messageId: "456",
        timestamp: 1710000000000,
      },
    } satisfies RemoteCodeCommandEnvelope);
  });

  it("keeps offline hosts pending without pretending the run is active", async () => {
    const result = await handleRemoteCodeCommand(
      telegramIncoming("fix it", "/code fix it"),
      adapter,
      {
        resolveOwner: () => "owner@example.test",
        relay: async () => ({
          ok: true,
          commandId: "cmd_123",
          hostOnline: false,
          hostStatus: "asleep",
        }),
      },
    );

    expect(result).toEqual({
      handled: true,
      responseText:
        "Queued code run (cmd_123). Your computer looks offline or asleep, so it will pick this up when it wakes.",
    });
  });

  it("formats recent run lists compactly", async () => {
    const result = await handleRemoteCodeCommand(
      telegramIncoming("list", "/code list"),
      adapter,
      {
        resolveOwner: () => "owner@example.test",
        relay: async () => ({
          ok: true,
          runs: [
            { id: "run_a", title: "Fix auth", status: "running" },
            { id: "run_b", title: "Add docs", status: "completed" },
          ],
        }),
      },
    );

    expect(result).toEqual({
      handled: true,
      responseText:
        "Recent code-agent runs:\n1. Fix auth — running (run_a)\n2. Add docs — completed (run_b)",
    });
  });
});
