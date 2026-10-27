// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit/client";
import type {
  AgentThreadSnapshot,
  AgentTransport,
} from "@agent-native/agentkit/protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  realtimeVoiceTranscriptRegistry,
  type RealtimeVoiceTranscriptMessage,
  type RealtimeVoiceWorkUpdate,
} from "../../../composer/realtime-voice-transcript.js";
import { ComposerRuntimeAdaptersProvider } from "../../../composer/runtime-adapters.js";
import { AgentKitChat } from "./components.js";
import { AgentKitProvider } from "./context.js";

const AT = "2026-10-24T00:00:00.000Z";
const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  vi.unstubAllGlobals();
});

async function mountChat(threadId: string) {
  const saved: AgentThreadSnapshot[] = [];
  const transport: AgentTransport = {
    async startRun() {
      return { runId: "unused" };
    },
    async *subscribeToRun() {},
    async cancelRun() {},
    async getThreadSnapshot() {
      return { id: threadId, createdAt: AT, updatedAt: AT, messages: [] };
    },
    async persistThreadSnapshot({ snapshot }) {
      saved.push(snapshot);
    },
  };
  const client = new AgentKitClient({
    transport,
    aiSetupReadiness: "not-applicable",
    reconnect: { attempts: 0, delayMs: 0 },
  });
  await client.loadThread(threadId);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ComposerRuntimeAdaptersProvider adapters={{}}>
        <AgentKitProvider controller={client} threadId={threadId}>
          <AgentKitChat composer={false} />
        </AgentKitProvider>
      </ComposerRuntimeAdaptersProvider>,
    );
    await Promise.resolve();
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    await client.shutdown();
    container.remove();
  });
  return { container, client, saved };
}

async function publish(
  threadId: string,
  message: Pick<RealtimeVoiceTranscriptMessage, "id" | "role" | "text"> &
    Partial<RealtimeVoiceTranscriptMessage>,
) {
  await act(async () => {
    realtimeVoiceTranscriptRegistry.publish({
      threadId,
      createdAt: AT,
      ...message,
    });
    // Controller updates reach React on the next macrotask.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const messages = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>("article.agentkit-message"),
  ).map((article) => ({
    role: article.dataset.role,
    text: article
      .querySelector(".agentkit-message-content")
      ?.textContent?.trim(),
    streaming: article.getAttribute("aria-busy") === "true",
  }));

describe("voice chat transcripts in AgentKitChat", () => {
  it("streams both sides into the transcript and finalizes them in place", async () => {
    const threadId = "thread-voice-stream";
    const { container, saved } = await mountChat(threadId);
    const user = `${threadId}:user-1`;
    const assistant = `${threadId}:assistant-1`;

    await publish(threadId, {
      id: user,
      role: "user",
      text: "Make the",
      status: "streaming",
    });
    await publish(threadId, {
      id: user,
      role: "user",
      text: "Make the header blue",
      status: "streaming",
    });
    await publish(threadId, {
      id: assistant,
      role: "assistant",
      text: "Sure,",
      status: "streaming",
    });

    expect(messages(container)).toEqual([
      { role: "user", text: "Make the header blue", streaming: true },
      expect.objectContaining({ role: "assistant", streaming: true }),
    ]);
    expect(saved).toEqual([]);

    await publish(threadId, {
      id: user,
      role: "user",
      text: "Make the header blue.",
    });

    // A turn still being spoken is never saved.
    expect(saved.at(-1)?.messages.map((message) => message.id)).toEqual([user]);

    await publish(threadId, {
      id: assistant,
      role: "assistant",
      text: "Sure, the header is blue now.",
    });
    expect(messages(container)).toEqual([
      { role: "user", text: "Make the header blue.", streaming: false },
      expect.objectContaining({ role: "assistant", streaming: false }),
    ]);
    expect(saved.at(-1)?.messages).toEqual([
      expect.objectContaining({
        id: user,
        role: "user",
        status: "complete",
        metadata: { custom: { source: "realtime-voice" } },
      }),
      expect.objectContaining({
        id: assistant,
        role: "assistant",
        status: "complete",
        parts: [{ type: "text", text: "Sure, the header is blue now." }],
      }),
    ]);
  });

  it("ignores a repeated final transcript", async () => {
    const threadId = "thread-voice-duplicate";
    const { container, saved } = await mountChat(threadId);
    const id = `${threadId}:user-1`;

    await publish(threadId, { id, role: "user", text: "Open the docs" });
    await publish(threadId, { id, role: "user", text: "Open the docs" });
    await publish(threadId, {
      id,
      role: "user",
      text: "Open the docs again",
      status: "streaming",
    });

    expect(messages(container)).toEqual([
      { role: "user", text: "Open the docs", streaming: false },
    ]);
    expect(saved).toHaveLength(1);
  });

  it("only lands turns for its own thread", async () => {
    const threadId = "thread-voice-own";
    const { container } = await mountChat(threadId);

    await publish("thread-voice-elsewhere", {
      id: "thread-voice-elsewhere:user-1",
      role: "user",
      text: "Not for this chat",
    });

    expect(messages(container)).toEqual([]);
  });

  it("waits for running work to finish before saving a final turn", async () => {
    const threadId = "thread-voice-open-work";
    const { saved } = await mountChat(threadId);
    const call = {
      id: "call-edit",
      name: "edit-design",
      startedAt: "2026-10-24T00:00:02.000Z",
    };
    const publishWork = async (update: RealtimeVoiceWorkUpdate) => {
      await act(async () => {
        realtimeVoiceTranscriptRegistry.publishWork(update);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    await publishWork({
      id: "call-edit",
      threadId,
      calls: [{ ...call, status: "running" }],
    });
    await publish(threadId, {
      id: `${threadId}:user-2`,
      role: "user",
      text: "Make it blue too.",
      createdAt: "2026-10-24T00:00:03.000Z",
    });
    expect(saved).toEqual([]);

    await publishWork({
      id: "call-edit",
      threadId,
      calls: [
        {
          ...call,
          status: "completed",
          output: "{}",
          completedAt: "2026-10-24T00:00:04.000Z",
        },
      ],
      completedAt: "2026-10-24T00:00:04.000Z",
    });
    expect(saved.at(-1)?.runs).toEqual([
      expect.objectContaining({ id: "voice:call-edit", status: "completed" }),
    ]);
    expect(saved.at(-1)?.messages.map((message) => message.id)).toContain(
      `${threadId}:user-2`,
    );
  });

  it("shows a reply's tool calls as one work item between the turns and saves it", async () => {
    const threadId = "thread-voice-work";
    const { container, client, saved } = await mountChat(threadId);
    const search = {
      id: "call-search",
      name: "web-search",
      input: { query: "cats" },
      startedAt: "2026-10-24T00:00:02.000Z",
    };
    const read = {
      id: "call-read",
      name: "web-request",
      input: { url: "https://example.com/cats" },
      startedAt: "2026-10-24T00:00:03.000Z",
    };
    const publishWork = async (update: RealtimeVoiceWorkUpdate) => {
      await act(async () => {
        realtimeVoiceTranscriptRegistry.publishWork(update);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    const reply = { id: "call-search", threadId };

    await publish(threadId, {
      id: `${threadId}:user-1`,
      role: "user",
      text: "Search the web for cats.",
    });
    await publish(threadId, {
      id: `${threadId}:assistant-1`,
      role: "assistant",
      text: "On it, searching now.",
      createdAt: "2026-10-24T00:00:01.000Z",
    });
    await publishWork({ ...reply, calls: [{ ...search, status: "running" }] });

    const running = container.textContent ?? "";
    expect(running.indexOf("Searched 1 query")).toBeGreaterThan(
      running.indexOf("On it, searching now."),
    );
    // The local run never holds the composer the way a server run does.
    expect(client.getThread(threadId).activeRunIds).toEqual([]);

    const finishedSearch = {
      ...search,
      status: "completed" as const,
      output: "{}",
      completedAt: "2026-10-24T00:00:02.500Z",
    };
    await publishWork({
      ...reply,
      calls: [finishedSearch, { ...read, status: "running" }],
    });
    await publishWork({
      ...reply,
      calls: [
        finishedSearch,
        {
          ...read,
          status: "completed",
          output: "<html>",
          completedAt: "2026-10-24T00:00:04.000Z",
        },
      ],
      completedAt: "2026-10-24T00:00:04.000Z",
    });
    await publish(threadId, {
      id: `${threadId}:assistant-2`,
      role: "assistant",
      text: "Cats are great.",
      createdAt: "2026-10-24T00:00:05.000Z",
    });

    const done = container.textContent ?? "";
    expect(done.match(/Worked/g)).toHaveLength(1);
    const row = done.indexOf("Worked");
    expect(row).toBeGreaterThan(done.indexOf("On it, searching now."));
    expect(row).toBeLessThan(done.indexOf("Cats are great."));
    expect(saved.at(-1)?.events?.map((event) => event.type)).toEqual([
      "tool.started",
      "activity.started",
      "tool.updated",
      "activity.completed",
      "tool.started",
      "activity.started",
      "tool.updated",
      "activity.completed",
      "run.completed",
    ]);
    expect(saved.at(-1)?.runs).toEqual([
      expect.objectContaining({ id: "voice:call-search", status: "completed" }),
    ]);
  });
});
