// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  buildStreamingFrameDocument,
  isStreamingFrameReadyMessage,
  STREAMING_FRAME_READY_MESSAGE,
} from "./streaming-frame";

function frameScript(doc: string): string {
  const match = /<script>([\s\S]*)<\/script><\/head>/.exec(doc);
  if (!match?.[1]) throw new Error("frame document has no script");
  return match[1];
}

describe("buildStreamingFrameDocument", () => {
  it("serializes a script that compiles on its own", () => {
    const script = frameScript(buildStreamingFrameDocument());
    expect(() => new Function(script)).not.toThrow();
    expect(script).not.toMatch(/\bimport\b|\brequire\(/);
  });

  it("escapes the base href", () => {
    const doc = buildStreamingFrameDocument({
      baseHref: 'https://example.com/"><script>',
    });
    expect(doc).toContain(
      '<base href="https://example.com/&quot;>&lt;script>">',
    );
  });
});

describe("isStreamingFrameReadyMessage", () => {
  it("accepts only its own frame's ready message carrying its token", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const ready = (
      token: string,
      source: Window | null = frame.contentWindow,
    ) =>
      new MessageEvent("message", {
        data: { type: STREAMING_FRAME_READY_MESSAGE, token },
        source,
      });

    expect(buildStreamingFrameDocument({ token: "abc" })).toContain('"abc"');
    expect(isStreamingFrameReadyMessage(ready("abc"), frame, "abc")).toBe(true);
    expect(isStreamingFrameReadyMessage(ready("xyz"), frame, "abc")).toBe(
      false,
    );
    expect(
      isStreamingFrameReadyMessage(ready("abc", window), frame, "abc"),
    ).toBe(false);
    frame.remove();
  });
});
