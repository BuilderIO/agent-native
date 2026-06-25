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

function setViewport(width: number, height = 700) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

describe("AnnotatedCodeBlock annotations", () => {
  let container: HTMLDivElement;
  let root: Root;
  let innerWidthDescriptor: PropertyDescriptor | undefined;
  let innerHeightDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    innerWidthDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "innerWidth",
    );
    innerHeightDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "innerHeight",
    );
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
      .querySelectorAll(
        "[data-annotation-hover-card],[data-annotation-inline-overlay]",
      )
      .forEach((node) => node.remove());
    vi.useRealTimers();
    if (innerWidthDescriptor) {
      Object.defineProperty(window, "innerWidth", innerWidthDescriptor);
    }
    if (innerHeightDescriptor) {
      Object.defineProperty(window, "innerHeight", innerHeightDescriptor);
    }
    vi.unstubAllGlobals();
  });

  it("omits the language chip when a filename label is present", () => {
    act(() => {
      root.render(
        <AnnotatedCodeRead
          blockId="code-annotations"
          ctx={{}}
          data={{
            filename: "src/example.ts",
            language: "typescript",
            code: "const value = 1;",
            annotations: [],
          }}
        />,
      );
    });

    expect(container.textContent).toContain("src/example.ts");
    expect(container.textContent).not.toContain("typescript");
  });

  it("mutes the directory and emphasizes the filename in the header", () => {
    act(() => {
      root.render(
        <AnnotatedCodeRead
          blockId="code-annotations"
          ctx={{}}
          data={{
            filename: "packages/core/src/example.ts",
            language: "typescript",
            code: "const value = 1;",
            annotations: [],
          }}
        />,
      );
    });

    const directory = container.querySelector("[data-code-filename-directory]");
    const basename = container.querySelector("[data-code-filename-basename]");

    expect(directory?.textContent).toBe("packages/core/src/");
    expect(directory?.className).toContain("text-plan-muted");
    expect(basename?.textContent).toBe("example.ts");
    expect(basename?.className).toContain("text-plan-code-text");
  });

  it("renders numbered gutter markers on the first line of each annotated range", () => {
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
            ].join("\n"),
            annotations: [
              {
                lines: "2-3",
                label: "Middle",
                note: "This range has a visible marker.",
              },
              {
                lines: "4",
                label: "End",
                note: "This single line has another marker.",
              },
            ],
          }}
        />,
      );
    });

    const markers = Array.from(
      container.querySelectorAll<HTMLElement>("[data-annotated-code-marker]"),
    );
    expect(markers).toHaveLength(2);
    expect(markers.map((marker) => marker.textContent)).toEqual(["1", "2"]);
    expect(
      container.querySelector(
        '[data-code-line="2"] [data-annotated-code-marker="1"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector(
        '[data-code-line="3"] [data-annotated-code-marker="1"]',
      ),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-code-line="2"]')
        ?.children.item(2)
        ?.hasAttribute("data-annotated-code-marker-stack"),
    ).toBe(true);
    expect(markers[0]?.className).toContain("cursor-pointer");
    expect(markers[0]?.hasAttribute("title")).toBe(false);
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

  it("uses the left side for plan-mode annotation hovers when it fits", () => {
    setViewport(1200);
    act(() => {
      root.render(
        <AnnotatedCodeRead
          blockId="code-annotations"
          ctx={{
            codeAnnotationLayout: {
              hoverSide: "left",
              hoverFallbackSide: "right",
            },
          }}
          data={{
            language: "ts",
            code: ["const one = 1;", "const two = 2;"].join("\n"),
            annotations: [
              {
                lines: "1",
                label: "Entry",
                note: "The first line is annotated.",
              },
            ],
          }}
        />,
      );
    });

    const codeBox = container.querySelector("section > div");
    expect(codeBox).toBeTruthy();
    stubRect(codeBox!, rect({ left: 360, top: 80, width: 500, height: 80 }));

    const firstLine = container.querySelector<HTMLElement>(
      '[data-code-line="1"]',
    );
    expect(firstLine).toBeTruthy();
    stubRect(firstLine!, rect({ left: 360, top: 100, width: 500, height: 22 }));

    act(() => {
      firstLine!.dispatchEvent(
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
    expect(card!.style.left).toBe("68px");
  });

  it("shows plan-mode annotation cards in the margin when there is room", () => {
    setViewport(1200);
    act(() => {
      root.render(
        <AnnotatedCodeRead
          blockId="code-annotations"
          ctx={{
            codeAnnotationLayout: {
              hoverSide: "left",
              hoverFallbackSide: "right",
              showByDefaultWhenRoom: true,
              marginSide: "auto",
            },
          }}
          data={{
            language: "ts",
            code: ["const one = 1;", "const two = 2;"].join("\n"),
            annotations: [
              {
                lines: "1",
                label: "Entry",
                note: "This note is visible in the margin.",
              },
            ],
          }}
        />,
      );
    });

    const codeBox = container.querySelector("section > div");
    expect(codeBox).toBeTruthy();
    stubRect(codeBox!, rect({ left: 360, top: 80, width: 500, height: 80 }));

    const firstLine = container.querySelector<HTMLElement>(
      '[data-code-line="1"]',
    );
    expect(firstLine).toBeTruthy();
    stubRect(firstLine!, rect({ left: 360, top: 100, width: 500, height: 22 }));

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    const anchor = container.querySelector(
      "[data-annotation-inline-overlay-anchor]",
    );
    expect(anchor).toBeTruthy();
    stubRect(anchor!, rect({ left: 850, top: 100, width: 0, height: 22 }));

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    const overlay = document.querySelector<HTMLElement>(
      "[data-annotation-inline-overlay]",
    );
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute("data-annotation-inline-overlay-mode")).toBe(
      "margin",
    );
    expect(overlay?.getAttribute("data-annotation-inline-overlay-side")).toBe(
      "left",
    );
    expect(overlay?.textContent).toContain(
      "This note is visible in the margin.",
    );

    act(() => {
      firstLine!.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(document.querySelector("[data-annotation-hover-card]")).toBeNull();
  });

  it("shows only the first plan-mode annotation by default when requested", () => {
    setViewport(1200);
    act(() => {
      root.render(
        <AnnotatedCodeRead
          blockId="code-annotations"
          ctx={{
            codeAnnotationLayout: {
              hoverSide: "left",
              hoverFallbackSide: "right",
              showByDefaultWhenRoom: true,
              defaultVisibleAnnotations: "first",
              marginSide: "auto",
            },
          }}
          data={{
            language: "ts",
            code: ["const one = 1;", "const two = 2;"].join("\n"),
            annotations: [
              {
                lines: "1",
                label: "Entry",
                note: "The first note is visible in the margin.",
              },
              {
                lines: "2",
                label: "Exit",
                note: "The second note still opens on hover.",
              },
            ],
          }}
        />,
      );
    });

    const codeBox = container.querySelector("section > div");
    expect(codeBox).toBeTruthy();
    stubRect(codeBox!, rect({ left: 360, top: 80, width: 500, height: 80 }));

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-code-line]"),
    );
    rows.forEach((row, index) => {
      stubRect(row, rect({ left: 360, top: 100 + index * 22, height: 22 }));
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    const anchor = container.querySelector(
      "[data-annotation-inline-overlay-anchor]",
    );
    expect(anchor).toBeTruthy();
    stubRect(anchor!, rect({ left: 850, top: 100, width: 0, height: 22 }));

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    const overlay = document.querySelector<HTMLElement>(
      "[data-annotation-inline-overlay]",
    );
    expect(overlay).toBeTruthy();
    expect(overlay?.textContent).toContain(
      "The first note is visible in the margin.",
    );
    expect(overlay?.textContent).not.toContain(
      "The second note still opens on hover.",
    );

    act(() => {
      rows[1]!.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });

    const hoverCard = document.querySelector<HTMLElement>(
      "[data-annotation-hover-card]",
    );
    expect(hoverCard).toBeTruthy();
    expect(hoverCard?.textContent).toContain(
      "The second note still opens on hover.",
    );
  });

  it("renders static annotation overlays when screenshot mode requests them", () => {
    act(() => {
      root.render(
        <AnnotatedCodeRead
          blockId="code-annotations"
          ctx={{ showCodeAnnotationOverlays: true }}
          data={{
            language: "ts",
            code: ["const one = 1;", "const two = 2;"].join("\n"),
            annotations: [
              {
                lines: "1",
                label: "Entry",
                note: "This note is visible without hover.",
              },
              {
                lines: "2",
                label: "Exit",
                note: "This note stays collapsed in capture mode.",
              },
            ],
          }}
        />,
      );
    });

    const overlays = document.querySelectorAll(
      "[data-annotation-inline-overlay]",
    );
    expect(overlays).toHaveLength(1);
    const overlay = overlays[0];
    expect(overlay).toBeTruthy();
    expect(
      container.querySelector("[data-annotation-inline-overlay]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-annotation-inline-overlay-anchor]"),
    ).toBeTruthy();
    expect(overlay?.textContent).toContain(
      "This note is visible without hover.",
    );
    expect(overlay?.textContent).not.toContain(
      "This note stays collapsed in capture mode.",
    );
    expect(document.querySelector("[data-annotation-hover-card]")).toBeNull();
  });

  it("does not immediately reopen the popover while scrolling under a hovered line", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    act(() => {
      root.render(
        <AnnotatedCodeRead
          blockId="code-annotations"
          ctx={{}}
          data={{
            language: "ts",
            code: ["const one = 1;", "const two = 2;"].join("\n"),
            annotations: [
              {
                lines: "1",
                label: "Entry",
                note: "The first line is annotated.",
              },
            ],
          }}
        />,
      );
    });

    const codeBox = container.querySelector("section > div");
    expect(codeBox).toBeTruthy();
    stubRect(codeBox!, rect({ top: 80, height: 80 }));

    const firstLine = container.querySelector<HTMLElement>(
      '[data-code-line="1"]',
    );
    expect(firstLine).toBeTruthy();
    stubRect(firstLine!, rect({ top: 100, height: 22 }));

    act(() => {
      firstLine!.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(document.querySelector("[data-annotation-hover-card]")).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(document.querySelector("[data-annotation-hover-card]")).toBeNull();

    act(() => {
      firstLine!.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(document.querySelector("[data-annotation-hover-card]")).toBeNull();

    vi.setSystemTime(300);
    act(() => {
      firstLine!.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(document.querySelector("[data-annotation-hover-card]")).toBeTruthy();
  });

  it("dismisses the popover when the viewport layout changes", () => {
    act(() => {
      root.render(
        <AnnotatedCodeRead
          blockId="code-annotations"
          ctx={{}}
          data={{
            language: "ts",
            code: ["const one = 1;", "const two = 2;"].join("\n"),
            annotations: [
              {
                lines: "1",
                label: "Entry",
                note: "The first line is annotated.",
              },
            ],
          }}
        />,
      );
    });

    const codeBox = container.querySelector("section > div");
    expect(codeBox).toBeTruthy();
    stubRect(codeBox!, rect({ top: 80, height: 80 }));

    const firstLine = container.querySelector<HTMLElement>(
      '[data-code-line="1"]',
    );
    expect(firstLine).toBeTruthy();
    stubRect(firstLine!, rect({ top: 100, height: 22 }));

    act(() => {
      firstLine!.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(document.querySelector("[data-annotation-hover-card]")).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(document.querySelector("[data-annotation-hover-card]")).toBeNull();
  });

  it("dismisses the popover when the user interacts outside it", () => {
    act(() => {
      root.render(
        <AnnotatedCodeRead
          blockId="code-annotations"
          ctx={{}}
          data={{
            language: "ts",
            code: ["const one = 1;", "const two = 2;"].join("\n"),
            annotations: [
              {
                lines: "1",
                label: "Entry",
                note: "The first line is annotated.",
              },
            ],
          }}
        />,
      );
    });

    const codeBox = container.querySelector("section > div");
    expect(codeBox).toBeTruthy();
    stubRect(codeBox!, rect({ top: 80, height: 80 }));

    const firstLine = container.querySelector<HTMLElement>(
      '[data-code-line="1"]',
    );
    expect(firstLine).toBeTruthy();
    stubRect(firstLine!, rect({ top: 100, height: 22 }));

    act(() => {
      firstLine!.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(document.querySelector("[data-annotation-hover-card]")).toBeTruthy();

    act(() => {
      container.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
        }),
      );
    });

    expect(document.querySelector("[data-annotation-hover-card]")).toBeNull();
  });

  it("keeps the popover open when the hover card itself scrolls", () => {
    act(() => {
      root.render(
        <AnnotatedCodeRead
          blockId="code-annotations"
          ctx={{}}
          data={{
            language: "ts",
            code: ["const one = 1;", "const two = 2;"].join("\n"),
            annotations: [
              {
                lines: "1",
                label: "Scrollable note",
                note: "A long annotation can scroll inside the hover card.",
              },
            ],
          }}
        />,
      );
    });

    const codeBox = container.querySelector("section > div");
    expect(codeBox).toBeTruthy();
    stubRect(codeBox!, rect({ top: 80, height: 80 }));

    const firstLine = container.querySelector<HTMLElement>(
      '[data-code-line="1"]',
    );
    expect(firstLine).toBeTruthy();
    stubRect(firstLine!, rect({ top: 100, height: 22 }));

    act(() => {
      firstLine!.dispatchEvent(
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

    act(() => {
      card!.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(document.querySelector("[data-annotation-hover-card]")).toBeTruthy();
  });
});
