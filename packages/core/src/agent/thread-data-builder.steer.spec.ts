import { describe, expect, it } from "vitest";

import { buildUserContentWithAttachments } from "./production-agent.js";
import {
  buildAssistantMessage,
  buildAssistantTurnSegments,
  buildUserMessage,
  foldAgentChatRunCompletion,
  recordSteeredQueuedMessages,
  steeredQueuedMessageRecords,
  threadDataToEngineMessages,
} from "./thread-data-builder.js";
import { buildTurnResumeContext } from "./turn-resume-context.js";
import type { RunEvent } from "./types.js";

const steerAt = "2026-10-24T10:00:05.000Z";

function steeredEvents(): RunEvent[] {
  return [
    { seq: 0, event: { type: "text", text: "Checking the deck." } },
    {
      seq: 1,
      event: {
        type: "tool_start",
        id: "call-1",
        tool: "read-deck",
        input: { id: "deck-1" },
      },
    },
    {
      seq: 2,
      event: {
        type: "tool_done",
        id: "call-1",
        tool: "read-deck",
        result: "3 slides",
      },
    },
    {
      seq: 3,
      event: {
        type: "user_message",
        message: {
          id: "queued-1",
          text: "Use the blue theme",
          createdAt: steerAt,
        },
        continuationMessageId: "server-run-1:after:queued-1",
      },
    },
    { seq: 4, event: { type: "text", text: "Switching to blue." } },
    { seq: 5, event: { type: "done" } },
  ];
}

function promptRepo() {
  const prompt = buildUserMessage({
    text: "Make the deck better",
    runId: "run-1",
    turnId: "turn-1",
    createdAt: new Date("2026-10-24T10:00:00.000Z"),
  });
  return {
    repo: {
      messages: [{ message: prompt, parentId: null }],
      headId: prompt.id,
    },
    prompt,
  };
}

const run = {
  runId: "run-1",
  threadId: "thread-1",
  turnId: "turn-1",
  status: "completed" as const,
  startedAt: Date.parse("2026-10-24T10:00:01.000Z"),
  events: [{ seq: 5, event: { type: "done" as const } }],
};

function transcript(repo: any) {
  return repo.messages.map((entry: any) => ({
    id: entry.message.id,
    role: entry.message.role,
    parentId: entry.parentId,
    text: entry.message.content
      .flatMap((part: any) => (part.type === "text" ? [part.text] : []))
      .join(""),
  }));
}

describe("messages sent into a running turn", () => {
  it("builds a run without one exactly as before", () => {
    const events = steeredEvents().filter(
      ({ event }) => event.type !== "user_message",
    );

    const turn = buildAssistantTurnSegments(events, "run-1", {
      turnId: "turn-1",
    });

    expect(turn.steered).toEqual([]);
    expect({ ...turn.assistant, createdAt: undefined }).toEqual({
      ...buildAssistantMessage(events, "run-1", { turnId: "turn-1" }),
      createdAt: undefined,
    });
  });

  it("splits the reply at the delivered message", () => {
    const turn = buildAssistantTurnSegments(steeredEvents(), "run-1", {
      turnId: "turn-1",
      runDurationMs: 9000,
    });

    expect(turn.assistant?.content.map((part) => part.type)).toEqual([
      "text",
      "tool-call",
    ]);
    expect(turn.assistant?.metadata.custom).not.toHaveProperty(
      "agentNativeRunDurationMs",
    );
    expect(turn.steered).toHaveLength(1);
    expect(turn.steered[0]!.user).toMatchObject({
      id: "queued-1",
      role: "user",
      content: [{ type: "text", text: "Use the blue theme" }],
      metadata: {
        custom: {
          agentNativeQueuedMessageId: "queued-1",
          deliveredInRunId: "run-1",
        },
      },
    });
    expect(turn.steered[0]!.user.metadata.custom).not.toHaveProperty(
      "submittedRunId",
    );
    expect(turn.steered[0]!.assistant).toMatchObject({
      id: "server-run-1:after:queued-1",
      content: [{ type: "text", text: "Switching to blue." }],
      metadata: { runId: "run-1", custom: { agentNativeRunDurationMs: 9000 } },
    });
  });

  it("folds the delivered message between the two replies, once", () => {
    const { repo, prompt } = promptRepo();
    const turn = buildAssistantTurnSegments(steeredEvents(), "run-1", {
      turnId: "turn-1",
    });

    const folded = foldAgentChatRunCompletion(
      repo,
      turn.assistant,
      { ...run, parentId: prompt.id },
      turn.steered,
    );
    const refolded = foldAgentChatRunCompletion(
      folded,
      turn.assistant,
      { ...run, parentId: prompt.id },
      turn.steered,
    );

    const expected = [
      {
        id: prompt.id,
        role: "user",
        parentId: null,
        text: "Make the deck better",
      },
      {
        id: "server-run-1",
        role: "assistant",
        parentId: prompt.id,
        text: "Checking the deck.",
      },
      {
        id: "queued-1",
        role: "user",
        parentId: "server-run-1",
        text: "Use the blue theme",
      },
      {
        id: "server-run-1:after:queued-1",
        role: "assistant",
        parentId: "queued-1",
        text: "Switching to blue.",
      },
    ];
    expect(transcript(folded)).toEqual(expected);
    expect(transcript(refolded)).toEqual(expected);
    expect(refolded.headId).toBe("server-run-1:after:queued-1");
  });

  it("places a message the run took but never journaled after its reply", () => {
    const { repo, prompt } = promptRepo();
    const events = steeredEvents().filter(
      ({ event }) => event.type !== "user_message",
    );
    const [record] = steeredQueuedMessageRecords(
      "run-1",
      [{ id: "queued-1", text: "Use the blue theme" }],
      Date.parse(steerAt),
    );
    const withRecord = recordSteeredQueuedMessages(repo, [record!]);
    const turn = buildAssistantTurnSegments(events, "run-1", {
      turnId: "turn-1",
    });

    const folded = foldAgentChatRunCompletion(
      withRecord,
      turn.assistant,
      { ...run, parentId: prompt.id },
      turn.steered,
    );

    expect(transcript(folded).map(({ id }: { id: string }) => id)).toEqual([
      prompt.id,
      "server-run-1",
      "queued-1",
    ]);
    expect(folded._steeredQueuedMessages).toEqual([]);
  });

  it("replays the delivered message to the model after the tool results it followed", () => {
    const { repo, prompt } = promptRepo();
    const turn = buildAssistantTurnSegments(steeredEvents(), "run-1", {
      turnId: "turn-1",
    });
    const folded = foldAgentChatRunCompletion(
      repo,
      turn.assistant,
      { ...run, parentId: prompt.id },
      turn.steered,
    );

    const history = threadDataToEngineMessages(folded, {
      includeToolCalls: true,
    });
    const steerIndex = history.findIndex((message) =>
      message.content.some(
        (part) => part.type === "text" && part.text === "Use the blue theme",
      ),
    );
    const resultIndex = history.findIndex((message) =>
      message.content.some((part) => part.type === "tool-result"),
    );

    expect(history[steerIndex]?.role).toBe("user");
    expect(resultIndex).toBeGreaterThanOrEqual(0);
    expect(steerIndex).toBeGreaterThan(resultIndex);
  });

  it("keeps the delivered message when a hard-killed run resumes from its journal", () => {
    const resumed = buildTurnResumeContext({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Make the deck better" }],
        },
      ],
      journal: null,
      events: steeredEvents().map(({ event }) => event),
      steeredUserContent: (message) =>
        buildUserContentWithAttachments({ text: message.text }),
    });

    const texts = resumed.messages.map((message) =>
      message.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join(""),
    );
    const steerIndex = texts.indexOf("Use the blue theme");
    expect(steerIndex).toBeGreaterThan(0);
    expect(resumed.messages[steerIndex]?.role).toBe("user");
    expect(texts.slice(steerIndex + 1).join("")).toContain(
      "Switching to blue.",
    );
  });

  it("replays a delivered message's attachments when the run resumes", () => {
    const attachments = [
      {
        type: "image" as const,
        name: "blue.png",
        url: "https://cdn.example.com/blue.png",
        mediaType: "image/png",
        contentType: "image/png",
      },
    ];
    const events = steeredEvents().map(({ event }) =>
      event.type === "user_message"
        ? { ...event, message: { ...event.message, attachments } }
        : event,
    );
    const steeredUserContent = (message: {
      text: string;
      attachments?: typeof attachments;
    }) =>
      buildUserContentWithAttachments({
        text: message.text,
        attachments: message.attachments,
        vision: true,
      });

    const resumed = buildTurnResumeContext({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Make the deck better" }],
        },
      ],
      journal: null,
      events,
      steeredUserContent,
    });

    const expected = steeredUserContent({
      text: "Use the blue theme",
      attachments,
    });
    expect(JSON.stringify(expected)).toContain(
      "https://cdn.example.com/blue.png",
    );
    expect(resumed.messages).toContainEqual({
      role: "user",
      content: expected,
    });
  });
});
