import { expect, it, vi } from "vitest";

import type { EngineStreamOptions } from "./engine/types.js";
import { ModelAttemptMeasurement } from "./model-attempt.js";

it.each(["toJSON", "getter", "proxy"])(
  "request sizing does not execute a %s hook or alter the dispatched text",
  (kind) => {
    const text = { type: "text" as const, text: "Keep this request" };
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
          : new Proxy({}, { ownKeys: mutate });
    const options: EngineStreamOptions = {
      model: "test",
      systemPrompt: "Test",
      tools: [],
      messages: [
        { role: "user", content: [text] },
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
