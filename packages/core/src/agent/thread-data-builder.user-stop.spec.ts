import { describe, expect, it } from "vitest";

import {
  buildAssistantTurnSegments,
  buildUserMessage,
  extractThreadMeta,
  foldAgentChatRunCompletion,
  threadDataToEngineMessages,
} from "./thread-data-builder.js";
import type { RunEvent } from "./types.js";

const PROMPT =
  "Write 20 numbered sentences about the ocean, each about 25 words long. No tools.";

function promptRepo() {
  const prompt = buildUserMessage({
    text: PROMPT,
    runId: "run-stop",
    turnId: "turn-stop",
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

// What Stop leaves in the journal: the output so far, then the abort's
// terminal event.
const stopped: RunEvent = { seq: 99, event: { type: "done", reason: "user" } };

function foldStoppedRun(events: RunEvent[]) {
  const { repo, prompt } = promptRepo();
  const turn = buildAssistantTurnSegments(events, "run-stop", {
    turnId: "turn-stop",
    suppressInternalContinuation: true,
  });
  return foldAgentChatRunCompletion(
    repo,
    turn.assistant,
    {
      runId: "run-stop",
      threadId: "thread-stop",
      turnId: "turn-stop",
      parentId: prompt.id,
      status: "aborted",
      abortReason: "user",
      startedAt: Date.parse("2026-10-24T10:00:01.000Z"),
      events,
    },
    turn.steered,
  );
}

function storedMessages(repo: any) {
  return repo.messages.map((entry: any) => entry.message ?? entry);
}

describe("folding a run the user stopped", () => {
  const partial: RunEvent[] = [
    { seq: 0, event: { type: "text", text: "1. The ocean covers most " } },
    {
      seq: 1,
      event: { type: "text", text: "of Earth.\n14. Mangrove forests grow" },
    },
    { seq: 2, event: { type: "text", text: " along tropical co" } },
    { ...stopped, seq: 3 },
  ];

  it("saves the partial reply as the turn's stopped answer", () => {
    const folded = foldStoppedRun(partial);

    const assistant = storedMessages(folded).at(-1);
    expect(assistant).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "1. The ocean covers most of Earth.\n14. Mangrove forests grow along tropical co",
        },
      ],
      status: { type: "complete", reason: "stop" },
      metadata: {
        runId: "run-stop",
        custom: { turnId: "turn-stop", userStopped: true },
      },
    });
    expect(folded.agentKit.runs).toContainEqual(
      expect.objectContaining({ id: "run-stop", status: "cancelled" }),
    );
  });

  it("keeps tool calls that finished before the stop", () => {
    const folded = foldStoppedRun([
      { seq: 0, event: { type: "text", text: "Looking it up." } },
      {
        seq: 1,
        event: {
          type: "tool_start",
          id: "call-1",
          tool: "search-notes",
          input: { query: "ocean" },
        },
      },
      {
        seq: 2,
        event: {
          type: "tool_done",
          id: "call-1",
          tool: "search-notes",
          result: "3 notes",
        },
      },
      { seq: 3, event: { type: "text", text: "Found three no" } },
      { ...stopped, seq: 4 },
    ]);

    expect(storedMessages(folded).at(-1).content).toEqual([
      { type: "text", text: "Looking it up." },
      expect.objectContaining({
        type: "tool-call",
        toolName: "search-notes",
        result: "3 notes",
      }),
      { type: "text", text: "Found three no" },
    ]);
  });

  it("saves no assistant message for a run stopped before it wrote anything", () => {
    const folded = foldStoppedRun([{ ...stopped, seq: 0 }]);

    expect(storedMessages(folded).map((message: any) => message.role)).toEqual([
      "user",
    ]);
    expect(folded.agentKit.runs).toContainEqual(
      expect.objectContaining({ id: "run-stop", status: "cancelled" }),
    );
  });

  it("gives the next turn's model the partial reply", () => {
    const folded = foldStoppedRun(partial);

    expect(threadDataToEngineMessages(folded)).toEqual([
      { role: "user", content: [{ type: "text", text: PROMPT }] },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "1. The ocean covers most of Earth.\n14. Mangrove forests grow along tropical co",
          },
        ],
      },
    ]);
  });

  it("titles the thread from its prompt", () => {
    expect(extractThreadMeta(foldStoppedRun(partial)).title).toBe(
      PROMPT.slice(0, 80),
    );
  });
});
