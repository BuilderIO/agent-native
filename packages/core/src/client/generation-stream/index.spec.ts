import { describe, expect, it } from "vitest";

import * as generationStream from "./index";

describe("@agent-native/core/client/generation-stream", () => {
  it("exports the preview building blocks apps compose", () => {
    expect(Object.keys(generationStream).sort()).toEqual(
      [
        "DRAFTING_ATTRIBUTE",
        "SKELETON_ATTRIBUTE",
        "STREAMED_IN_ATTRIBUTE",
        "STREAMED_IN_CSS",
        "STREAMING_FRAME_MESSAGE",
        "STREAMING_FRAME_READY_MESSAGE",
        "TOOL_DONE_EVENT",
        "TOOL_INPUT_EVENT",
        "buildStreamingFrameDocument",
        "createDraftOutlines",
        "isJsonStringComplete",
        "isStreamingFrameReadyMessage",
        "morphChildren",
        "parsePartialJson",
        "postStreamingFrameHtml",
        "readJsonPath",
        "renderableHtmlPrefix",
        "useStreamingToolInput",
        "useStreamingToolInputs",
      ].sort(),
    );
  });
});
