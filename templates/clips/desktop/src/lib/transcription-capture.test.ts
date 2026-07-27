import { describe, expect, it } from "vitest";

import { __test } from "./transcription-capture";

function result(transcript: string, isFinal: boolean) {
  return {
    isFinal,
    0: { transcript },
  };
}

describe("Web Speech transcription buffer", () => {
  it("keeps finalized text across recognition restarts", () => {
    const buffer = __test.createWebSpeechTranscriptBuffer();

    buffer.update({
      resultIndex: 0,
      results: [result("first session", true)],
    });
    expect(buffer.text()).toBe("first session");

    buffer.commitSession();
    buffer.update({
      resultIndex: 0,
      results: [result("second session", true)],
    });

    expect(buffer.text()).toBe("first session second session");
  });

  it("keeps trailing interim text when stopping", () => {
    const buffer = __test.createWebSpeechTranscriptBuffer();

    buffer.update({
      resultIndex: 0,
      results: [result("final text", true), result(" trailing interim", false)],
    });
    buffer.commitSession({ preserveInterim: true });

    expect(buffer.text()).toBe("final text trailing interim");
  });
});
