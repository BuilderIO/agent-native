import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "SlideEditor.tsx"),
  "utf8",
);

describe("SlideEditor marquee pointer tracking", () => {
  it("keeps the window pointer stream stable while the overlay rerenders", () => {
    const handlerSource = editorSource.slice(
      editorSource.indexOf(
        "// Keep these listeners stable while React re-renders the marquee overlay.",
      ),
      editorSource.indexOf(
        "/** Send the current selection",
        editorSource.indexOf("// Keep these listeners"),
      ),
    );

    expect(handlerSource).not.toContain("if (!marquee) return");
    expect(handlerSource).toContain("const current = marqueeRef.current");
    expect(handlerSource).toContain(
      'window.addEventListener("pointercancel", onCancel)',
    );
    expect(handlerSource).toContain(
      "}, [getSlideContent, applyMultiSelection]);",
    );
    expect(editorSource).toContain("marqueeRef.current = initialMarquee");
    expect(editorSource).toContain(
      "e.currentTarget.setPointerCapture(e.pointerId)",
    );
  });
});
