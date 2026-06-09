// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotatedCodeRead } from "./AnnotatedCodeBlock.js";

function rect({
  left = 20,
  top,
  width = 500,
  height,
}: {
  left?: number;
  top: number;
  width?: number;
  height: number;
}): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function stubRect(element: Element, value: DOMRect) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => value,
  });
}

describe("AnnotatedCodeBlock annotations", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document
      .querySelectorAll("[data-annotation-hover-card]")
      .forEach((node) => node.remove());
    vi.unstubAllGlobals();
  });

  it("anchors a multi-line annotation popover to the first line in the range", () => {
    act(() => {
      root.render(
        <AnnotatedCodeRead
          blockId="code-annotations"
          ctx={{}}
          data={{
            language: "ts",
            code: [
              "const one = 1;",
              "const two = 2;",
              "const three = 3;",
              "const four = 4;",
              "const five = 5;",
            ].join("\n"),
            annotations: [
              {
                lines: "2-4",
                label: "Block",
                note: "These lines form one annotation.",
              },
            ],
          }}
        />,
      );
    });

    const codeBox = container.querySelector("section > div");
    expect(codeBox).toBeTruthy();
    stubRect(codeBox!, rect({ top: 80, height: 140 }));

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-code-line]"),
    );
    rows.forEach((row, index) => {
      stubRect(row, rect({ top: 100 + index * 22, height: 22 }));
    });

    const lastAnnotatedLine = container.querySelector<HTMLElement>(
      '[data-code-line="4"]',
    );
    expect(lastAnnotatedLine).toBeTruthy();

    act(() => {
      lastAnnotatedLine!.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });

    const card = document.querySelector<HTMLElement>(
      "[data-annotation-hover-card]",
    );
    expect(card).toBeTruthy();
    // Line 2 starts at y=122 with a 22px height, so the first-line anchor center
    // is 133px. Hovering line 4 would have produced 177px before this fix.
    expect(card!.style.top).toBe("133px");
  });
});
