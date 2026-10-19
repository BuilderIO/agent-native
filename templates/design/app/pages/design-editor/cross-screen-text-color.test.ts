// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  adaptAutoTextColorForCrossScreenNode,
  BOARD_TEXT_AUTO_COLOR_MARKER,
} from "./cross-screen-text-color";

describe("adaptAutoTextColorForCrossScreenNode", () => {
  it("adapts auto-selected black text when it moves to a dark screen", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="screen" style="background:#111111">
        <span data-agent-native-node-id="text" data-an-primitive="text" ${BOARD_TEXT_AUTO_COLOR_MARKER} style="color:#000000">Text</span>
      </div>
    </body></html>`;

    const adapted = adaptAutoTextColorForCrossScreenNode(content, "text");
    const doc = new DOMParser().parseFromString(adapted, "text/html");
    const text = doc.querySelector<HTMLElement>(
      '[data-agent-native-node-id="text"]',
    );

    expect(text?.style.color).toBe("#ffffff");
    expect(text?.ownerDocument.defaultView?.getComputedStyle(text).color).toBe(
      "#ffffff",
    );
    expect(text?.hasAttribute(BOARD_TEXT_AUTO_COLOR_MARKER)).toBe(true);
  });
});
