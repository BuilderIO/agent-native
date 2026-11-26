import { expect, it, vi } from "vitest";

import type { EngineStreamOptions } from "./engine/types.js";
import { ModelAttemptMeasurement } from "./model-attempt.js";

it.each([
  "toJSON",
  "getter",
  "proxy",
  "symbol iterator getter",
  "symbol iterator function",
])(
  "request sizing does not execute a %s hook or alter the dispatched text",
  (kind) => {
    const text = { type: "text" as const, text: "Keep this request" };
    const content = [text];
    const mutate = vi.fn(() => {
      text.text = "Changed by sizing";
      throw new Error("Synthetic serialization failure");
    });
    const input =
      kind === "toJSON"
        ? { toJSON: mutate }
        : kind === "getter"
          ? Object.defineProperty({}, "value", {
              get: mutate,
              enumerable: true,
            })
          : kind === "proxy"
            ? new Proxy({}, { ownKeys: mutate })
            : {};
    if (kind.startsWith("symbol iterator")) {
      Object.defineProperty(
        content,
        Symbol.iterator,
        kind === "symbol iterator getter" ? { get: mutate } : { value: mutate },
      );
    }
    const options: EngineStreamOptions = {
      model: "test",
      systemPrompt: "Test",
      tools: [],
      messages: [
        { role: "user", content },
        {
          role: "assistant",
          content: [{ type: "tool-call", id: "old", name: "read", input }],
        },
      ],
      abortSignal: new AbortController().signal,
    };
    const measurement = new ModelAttemptMeasurement("test", 1, 0);
    measurement.request(options);
    const report = vi.fn();
    measurement.finish(report);
    expect(text.text).toBe("Keep this request");
    expect(mutate).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ requestSizeUnavailable: true }),
      expect.anything(),
    );
  },
);

it("groups unregistered tool results without retaining their supplied labels", () => {
  const measurement = new ModelAttemptMeasurement("test", 1, 0);
  measurement.request({
    model: "test",
    systemPrompt: "Test",
    abortSignal: new AbortController().signal,
    tools: [{ name: "read", description: "Read", inputSchema: {} }],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "known",
            toolName: "read",
            toolInput: "{}",
            content: "café",
          },
          {
            type: "tool-result",
            toolCallId: "unknown",
            toolName: "untrusted private label",
            toolInput: "{}",
            content: "hidden",
          },
        ],
      },
    ],
  });
  const report = vi.fn();
  measurement.finish(report);
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({
        toolResultBytes: { read: 5, "[unlisted]": 6 },
      }),
    }),
    expect.anything(),
  );
  expect(JSON.stringify(report.mock.calls)).not.toContain(
    "untrusted private label",
  );
});
