import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyInput,
  renderTranscript,
  summarizeRuns,
} from "./debug-runs.ts";

const threadData = {
  messages: [
    {
      message: {
        role: "user",
        createdAt: "2026-10-27T13:18:31.000Z",
        content: [{ type: "text", text: "make it blue" }],
        metadata: {
          custom: { submittedRunId: "run-1", submittedTurnId: "turn-1" },
        },
      },
    },
    {
      message: {
        role: "assistant",
        status: { type: "incomplete", reason: "error" },
        content: [
          { type: "reasoning", text: "check the design first" },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "edit-design",
            args: { designId: "d1" },
          },
        ],
        metadata: {
          runId: "run-1",
          custom: {
            runError: {
              errorCode: "invalid_request",
              message: "gateway failed",
            },
          },
        },
      },
    },
  ],
  agentKit: {
    runs: [
      { id: "run-1", status: "running", startedAt: "2026-10-27T13:18:32.000Z" },
    ],
  },
  _debugRuns: [{ runId: "run-1", model: "m", systemPromptHash: "h" }],
  _debugPrompts: {
    h: 'rules\n<current-screen>\n{"designId":"d1"}\n</current-screen>',
  },
};

describe("debug-runs", () => {
  it("merges a run across messages, agentKit and debug prompts, preferring the recorded error", () => {
    assert.deepEqual(summarizeRuns(threadData), [
      {
        runId: "run-1",
        status: "failed",
        startedAt: "2026-10-27T13:18:32.000Z",
        turnId: "turn-1",
        error: "invalid_request: gateway failed",
        model: "m",
        screen: '{"designId":"d1"}',
      },
    ]);
  });

  it("renders tool calls that never returned and the run error", () => {
    const transcript = renderTranscript(threadData, "raw.json");
    assert.match(
      transcript,
      /### tool edit-design \(c1\)[\s\S]*"designId": "d1"/,
    );
    assert.match(transcript, /result: \(none recorded/);
    assert.match(
      transcript,
      /\*\*run error:\*\* invalid_request: gateway failed/,
    );
  });

  it("takes the app and object id from beta and production links", () => {
    assert.deepEqual(
      classifyInput(
        "https://beta.slides.agent-native.com/deck/EXAMPLE_deck1?slide=2",
      ),
      {
        kind: "object",
        value: "EXAMPLE_deck1",
        app: "slides",
      },
    );
    assert.equal(classifyInput("run-1700000000000-example").kind, "run");
  });
});
