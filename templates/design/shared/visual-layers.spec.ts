import { describe, expect, it } from "vitest";

import {
  CANVAS_CONTEXT_RECORDER_SCRIPT,
  injectCanvasContextRecorder,
} from "./visual-layers";

describe("injectCanvasContextRecorder", () => {
  it("puts the recorder first in an existing head", () => {
    const html =
      "<!doctype html><html><head><title>t</title></head><body></body></html>";
    expect(injectCanvasContextRecorder(html)).toBe(
      `<!doctype html><html><head>${CANVAS_CONTEXT_RECORDER_SCRIPT}<title>t</title></head><body></body></html>`,
    );
  });

  it("ignores a head tag that only appears inside a script string", () => {
    const html = `<html><body><script>var s = "<!doctype html><html><head>";</script></body></html>`;
    const out = injectCanvasContextRecorder(html);
    expect(
      out.startsWith(`<html>${CANVAS_CONTEXT_RECORDER_SCRIPT}<body>`),
    ).toBe(true);
    expect(
      out.endsWith(`"<!doctype html><html><head>";</script></body></html>`),
    ).toBe(true);
  });

  it("falls back to the doctype, then to the start of the markup", () => {
    expect(injectCanvasContextRecorder("<!doctype html><body></body>")).toBe(
      `<!doctype html>${CANVAS_CONTEXT_RECORDER_SCRIPT}<body></body>`,
    );
    expect(injectCanvasContextRecorder("<main></main>")).toBe(
      `${CANVAS_CONTEXT_RECORDER_SCRIPT}<main></main>`,
    );
  });

  it("keeps the doctype first when a comment precedes it, and skips tags in comments", () => {
    expect(
      injectCanvasContextRecorder(
        "<!-- <head> --><!doctype html><body></body>",
      ),
    ).toBe(
      `<!-- <head> --><!doctype html>${CANVAS_CONTEXT_RECORDER_SCRIPT}<body></body>`,
    );
    expect(
      injectCanvasContextRecorder(
        "<!-- <script> <style> <body> --><!doctype html><body></body>",
      ),
    ).toBe(
      `<!-- <script> <style> <body> --><!doctype html>${CANVAS_CONTEXT_RECORDER_SCRIPT}<body></body>`,
    );
  });
});
