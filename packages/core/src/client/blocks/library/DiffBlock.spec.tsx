// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockRenderContext } from "../types.js";
import { DiffRead, diffLines } from "./DiffBlock.js";
import { NarrowContainerProvider } from "./narrow-container.js";

const DIFF_MODE_STORAGE_KEY = "agent-native:diff-view-mode";

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

describe("DiffBlock", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear();
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
    vi.unstubAllGlobals();
  });

  function renderDiff({
    before = "",
    after,
    blockId = "diff-1",
    filename = "src/example.ts",
    language,
    mode,
    annotations,
  }: {
    before?: string;
    after: string;
    blockId?: string;
    filename?: string;
    language?: string;
    mode?: "unified" | "split";
    annotations?: Array<{
      side?: "before" | "after";
      lines: string;
      label?: string;
      note: string;
    }>;
  }) {
    act(() => {
      root.render(
        <DiffRead
          key={blockId}
          blockId={blockId}
          ctx={{}}
          data={{ before, after, filename, language, mode, annotations }}
        />,
      );
    });
  }

  it("limits the initial unified diff to fifteen lines and can expand", () => {
    const addedLines = Array.from(
      { length: 18 },
      (_, index) => `added-${String(index + 1).padStart(2, "0")}`,
    ).join("\n");

    renderDiff({ after: addedLines });

    expect(container.textContent).toContain("added-15");
    expect(container.textContent).not.toContain("added-16");

    const showAll = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Show all 18 lines",
    );
    expect(showAll).toBeTruthy();

    act(() => {
      showAll?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(container.textContent).toContain("added-16");
    expect(container.textContent).toContain("added-18");
    expect(container.textContent).toContain("Show fewer");
  });

  it("limits the initial split diff to fifteen lines", () => {
    const addedLines = Array.from(
      { length: 18 },
      (_, index) => `split-${String(index + 1).padStart(2, "0")}`,
    ).join("\n");

    renderDiff({ after: addedLines, mode: "split" });

    expect(container.textContent).toContain("split-15");
    expect(container.textContent).not.toContain("split-16");
    expect(container.textContent).toContain("Show all 18 lines");
  });

  it("hides the show-all footer when annotations already reveal every split row", () => {
    const addedLines = Array.from(
      { length: 23 },
      (_, index) => `annotated-${String(index + 1).padStart(2, "0")}`,
    ).join("\n");

    renderDiff({
      after: addedLines,
      mode: "split",
      annotations: [
        { lines: "23", label: "Tail", note: "Keep the tail visible." },
      ],
    });

    expect(container.textContent).toContain("annotated-23");
    expect(container.textContent).not.toContain("Show all 23 lines");
  });

  it("defaults to split (two columns) when no mode is authored", () => {
    renderDiff({ after: "const a = 1\nconst b = 2" });

    // Split renders side-by-side columns by default and exposes the
    // Unified/Split toggle so the user can still switch to one-column review.
    expect(container.querySelector(".border-r.border-border")).toBeTruthy();
    const unifiedToggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Unified",
    );
    expect(unifiedToggle).toBeTruthy();
  });

  it("renders split (two columns) when split mode is authored", () => {
    act(() => {
      root.render(
        <DiffRead
          blockId="diff-split"
          ctx={{}}
          data={{
            before: "const a = 1",
            after: "const a = 2",
            filename: "src/example.ts",
            mode: "split",
          }}
        />,
      );
    });

    // Split renders the side-by-side columns (the left column carries the
    // `border-r` divider) — the authored mode wins.
    expect(container.querySelector(".border-r.border-border")).toBeTruthy();
  });

  it("does not let stored layout preference override authored split mode", () => {
    window.localStorage.setItem(DIFF_MODE_STORAGE_KEY, "unified");

    renderDiff({
      before: "const a = 1",
      after: "const a = 2",
      blockId: "diff-authored-split",
      mode: "split",
    });

    expect(container.querySelector(".border-r.border-border")).toBeTruthy();
  });

  it("the Unified/Split toggle switches the rendered layout", () => {
    act(() => {
      root.render(
        <DiffRead
          blockId="diff-toggle"
          ctx={{}}
          data={{
            before: "const a = 1",
            after: "const a = 2",
            filename: "src/example.ts",
          }}
        />,
      );
    });

    // Starts split (with the side-by-side divider).
    expect(container.querySelector(".border-r.border-border")).toBeTruthy();

    const unifiedToggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Unified",
    );
    expect(unifiedToggle).toBeTruthy();
    act(() => {
      unifiedToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    // Toggling to Unified removes the side-by-side columns.
    expect(container.querySelector(".border-r.border-border")).toBeNull();

    const splitToggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Split",
    );
    act(() => {
      splitToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    // ...and back to split.
    expect(container.querySelector(".border-r.border-border")).toBeTruthy();
  });

  it("persists the selected layout and applies it to future diff blocks", () => {
    renderDiff({
      before: "const a = 1",
      after: "const a = 2",
      blockId: "diff-persist-first",
    });

    expect(container.querySelector(".border-r.border-border")).toBeTruthy();

    const unifiedToggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Unified",
    );
    act(() => {
      unifiedToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(window.localStorage.getItem(DIFF_MODE_STORAGE_KEY)).toBe("unified");
    expect(container.querySelector(".border-r.border-border")).toBeNull();

    renderDiff({
      before: "const b = 1",
      after: "const b = 2",
      blockId: "diff-persist-next",
    });

    expect(container.querySelector(".border-r.border-border")).toBeNull();

    const splitToggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Split",
    );
    act(() => {
      splitToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(window.localStorage.getItem(DIFF_MODE_STORAGE_KEY)).toBe("split");
    expect(container.querySelector(".border-r.border-border")).toBeTruthy();
  });

  it("defaults an unspecified diff to unified inside a constrained container", () => {
    act(() => {
      root.render(
        <NarrowContainerProvider>
          <DiffRead
            blockId="diff-narrow"
            ctx={{}}
            data={{
              before: "const a = 1",
              after: "const a = 2",
              filename: "src/example.ts",
            }}
          />
        </NarrowContainerProvider>,
      );
    });

    // No authored mode + constrained container -> unified up front, and the toggle is
    // hidden (split's doubled gutters would crush the code in the tight box).
    expect(container.querySelector(".border-r.border-border")).toBeNull();
    const splitToggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Split",
    );
    expect(splitToggle).toBeFalsy();
  });

  it("honors an explicit split even inside a narrow container", () => {
    act(() => {
      root.render(
        <NarrowContainerProvider>
          <DiffRead
            blockId="diff-narrow-split"
            ctx={{}}
            data={{
              before: "const a = 1",
              after: "const a = 2",
              filename: "src/example.ts",
              mode: "split",
            }}
          />
        </NarrowContainerProvider>,
      );
    });

    // An explicitly authored `mode="split"` still wins over the narrow default.
    expect(container.querySelector(".border-r.border-border")).toBeTruthy();
  });

  it("shows the basename before a muted path without a language badge", () => {
    renderDiff({
      after: "line",
      filename: "packages/core/src/client/blocks/library/DiffBlock.spec.tsx",
      language: "tsx",
    });

    expect(container.textContent).toContain("DiffBlock.spec.tsx");
    expect(container.textContent).toContain(
      "packages/core/src/client/blocks/library",
    );
    expect(container.textContent).not.toContain("TSX");
  });

  it("falls back to a coarse replacement diff when LCS would allocate too much", () => {
    const before = Array.from({ length: 1_200 }, (_, index) => `old-${index}`)
      .join("\n")
      .concat("\n");
    const after = Array.from({ length: 1_200 }, (_, index) => `new-${index}`)
      .join("\n")
      .concat("\n");

    expect(diffLines(before, after)).toEqual([
      { value: before, removed: true },
      { value: after, added: true },
    ]);
  });
});

describe("DiffBlock annotations", () => {
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
    window.localStorage.clear();
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

  function render(
    data: {
      before: string;
      after: string;
      mode?: "unified" | "split";
      annotations?: Array<{
        side?: "before" | "after";
        lines: string;
        label?: string;
        note: string;
      }>;
    },
    ctx: Pick<
      BlockRenderContext,
      "showCodeAnnotationOverlays" | "codeAnnotationLayout"
    > = {},
  ) {
    act(() => {
      root.render(
        <DiffRead
          blockId="diff-anno"
          ctx={ctx}
          data={{ filename: "src/example.ts", ...data }}
        />,
      );
    });
  }

  it("renders the note rail and a numbered marker for an after-side annotation", () => {
    render({
      before: "const a = 1\nconst b = 2",
      after: "const a = 1\nconst b = 3",
      annotations: [{ lines: "2", label: "Changed", note: "b is now three." }],
    });

    // The note text and its marker number both appear.
    expect(container.textContent).toContain("b is now three.");
    expect(container.textContent).toContain("Changed");
    expect(container.textContent).toContain("Line 2");
    // The marker pip "1" shows on the row AND on the rail card.
    const ones = container.textContent?.match(/\b1\b/g) ?? [];
    expect(ones.length).toBeGreaterThan(0);
  });

  it("uses the stored layout preference for annotated diffs", () => {
    window.localStorage.setItem(DIFF_MODE_STORAGE_KEY, "split");

    render({
      before: "const a = 1",
      after: "const a = 2",
      annotations: [{ lines: "1", label: "Changed", note: "a changed." }],
    });

    expect(container.querySelector(".border-r.border-border")).toBeTruthy();
  });

  it("shows a multi-line annotation's marker only on the first line of its range", () => {
    render({
      before: "",
      after: "const a = 1\nconst b = 2\nconst c = 3\nconst d = 4\nconst e = 5",
      mode: "unified",
      annotations: [{ lines: "2-4", label: "Block", note: "Three lines." }],
    });

    // The range resolved across multiple lines…
    expect(container.textContent).toContain("Lines 2–4");

    // …yet the numbered pip renders exactly twice: once in the code gutter (the
    // first line of the span) and once on the rail card — NOT once per line.
    const pips = Array.from(
      container.querySelectorAll("span[aria-hidden]"),
    ).filter((el) => el.textContent?.trim() === "1");
    expect(pips).toHaveLength(2);
  });

  it("renders static annotation overlays when screenshot mode requests them", () => {
    render(
      {
        before: "",
        after: "const a = 1\nconst b = 2",
        mode: "unified",
        annotations: [
          { lines: "1", label: "First", note: "Visible without hover." },
          { lines: "2", label: "Second", note: "Still only a marker." },
        ],
      },
      { showCodeAnnotationOverlays: true },
    );

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
    expect(overlay?.textContent).toContain("Visible without hover.");
    expect(overlay?.textContent).not.toContain("Still only a marker.");
    expect(document.querySelector("[data-annotation-hover-card]")).toBeNull();
  });

  it("shows plan-mode diff annotation cards in the margin when there is room", () => {
    setViewport(1200);
    render(
      {
        before: "",
        after: "const a = 1\nconst b = 2",
        mode: "unified",
        annotations: [
          { lines: "2", label: "Changed", note: "Diff note in the margin." },
        ],
      },
      {
        codeAnnotationLayout: {
          hoverSide: "left",
          hoverFallbackSide: "right",
          showByDefaultWhenRoom: true,
          marginSide: "auto",
        },
      },
    );

    const codeSurface = container.querySelector("[data-code-surface]");
    const codeBox = codeSurface?.parentElement;
    expect(codeBox).toBeTruthy();
    stubRect(codeBox!, rect({ left: 360, top: 80, width: 500, height: 100 }));

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-code-surface] > div > div",
      ),
    );
    expect(rows).toHaveLength(2);
    rows.forEach((row, index) => {
      stubRect(
        row,
        rect({ left: 360, top: 100 + index * 20, width: 500, height: 20 }),
      );
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    const anchor = container.querySelector(
      "[data-annotation-inline-overlay-anchor]",
    );
    expect(anchor).toBeTruthy();
    stubRect(anchor!, rect({ left: 850, top: 120, width: 0, height: 20 }));

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
    expect(overlay?.textContent).toContain("Diff note in the margin.");

    act(() => {
      rows[1].dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(document.querySelector("[data-annotation-hover-card]")).toBeNull();
  });

  it("shows only the first plan-mode diff annotation by default when requested", () => {
    setViewport(1200);
    render(
      {
        before: "",
        after: "const a = 1\nconst b = 2",
        mode: "unified",
        annotations: [
          { lines: "1", label: "First", note: "First diff note is visible." },
          {
            lines: "2",
            label: "Second",
            note: "Second diff note still opens on hover.",
          },
        ],
      },
      {
        codeAnnotationLayout: {
          hoverSide: "left",
          hoverFallbackSide: "right",
          showByDefaultWhenRoom: true,
          defaultVisibleAnnotations: "first",
          marginSide: "auto",
        },
      },
    );

    const codeSurface = container.querySelector("[data-code-surface]");
    const codeBox = codeSurface?.parentElement;
    expect(codeBox).toBeTruthy();
    stubRect(codeBox!, rect({ left: 360, top: 80, width: 500, height: 100 }));

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-code-surface] > div > div",
      ),
    );
    expect(rows).toHaveLength(2);
    rows.forEach((row, index) => {
      stubRect(
        row,
        rect({ left: 360, top: 100 + index * 20, width: 500, height: 20 }),
      );
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    const anchor = container.querySelector(
      "[data-annotation-inline-overlay-anchor]",
    );
    expect(anchor).toBeTruthy();
    stubRect(anchor!, rect({ left: 850, top: 100, width: 0, height: 20 }));

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    const overlay = document.querySelector<HTMLElement>(
      "[data-annotation-inline-overlay]",
    );
    expect(overlay).toBeTruthy();
    expect(overlay?.textContent).toContain("First diff note is visible.");
    expect(overlay?.textContent).not.toContain(
      "Second diff note still opens on hover.",
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
      "Second diff note still opens on hover.",
    );
  });

  it("anchors a multi-line annotation popover to the first row in the range", () => {
    render({
      before: "",
      after: "const a = 1\nconst b = 2\nconst c = 3\nconst d = 4\nconst e = 5",
      mode: "unified",
      annotations: [{ lines: "2-4", label: "Block", note: "Three lines." }],
    });

    const codeSurface = container.querySelector("[data-code-surface]");
    const codeBox = codeSurface?.parentElement;
    expect(codeBox).toBeTruthy();
    stubRect(codeBox!, rect({ top: 80, height: 140 }));

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-code-surface] > div > div",
      ),
    );
    expect(rows).toHaveLength(5);
    rows.forEach((row, index) => {
      stubRect(row, rect({ top: 100 + index * 20, height: 20 }));
    });

    act(() => {
      rows[3].dispatchEvent(
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
    // Line 2 starts at y=120 with a 20px height, so the first-row anchor center
    // is 130px. Hovering line 4 would have produced 170px before this fix.
    expect(card!.style.top).toBe("130px");
  });

  it("does not immediately reopen the annotation popover during scroll dismissal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    render({
      before: "",
      after: "const a = 1\nconst b = 2",
      mode: "unified",
      annotations: [{ lines: "1", label: "Changed", note: "First line." }],
    });

    const codeSurface = container.querySelector("[data-code-surface]");
    const codeBox = codeSurface?.parentElement;
    expect(codeBox).toBeTruthy();
    stubRect(codeBox!, rect({ top: 80, height: 100 }));

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-code-surface] > div > div",
      ),
    );
    expect(rows).toHaveLength(2);
    stubRect(rows[0], rect({ top: 100, height: 20 }));

    act(() => {
      rows[0].dispatchEvent(
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
      rows[0].dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(document.querySelector("[data-annotation-hover-card]")).toBeNull();

    vi.setSystemTime(300);
    act(() => {
      rows[0].dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(document.querySelector("[data-annotation-hover-card]")).toBeTruthy();
  });

  it("renders unchanged when there are no annotations (back-compat)", () => {
    render({
      before: "x",
      after: "y",
    });
    // No rail wrapper grid and no annotation note.
    expect(container.querySelector(".grid")).toBeNull();
  });

  it("keeps an annotated unchanged line visible even inside a collapsed run", () => {
    // 20 identical context lines, then a change at the end. Line 5 (context,
    // deep inside the collapsed run) is annotated and must stay reachable.
    const context = Array.from(
      { length: 20 },
      (_, index) => `line-${String(index + 1).padStart(2, "0")}`,
    );
    const before = [...context, "tail-old"].join("\n");
    const after = [...context, "tail-new"].join("\n");

    render({
      before,
      after,
      annotations: [
        { side: "before", lines: "5", note: "An anchored unchanged line." },
      ],
    });

    // The annotated context line is rendered despite the collapse.
    expect(container.textContent).toContain("line-05");
    expect(container.textContent).toContain("An anchored unchanged line.");
  });

  it("does not crash when a line ref is out of range", () => {
    expect(() =>
      render({
        before: "a",
        after: "b",
        annotations: [{ lines: "999", note: "Out of range, skipped." }],
      }),
    ).not.toThrow();
    // An unresolved annotation drops out of the rail entirely.
    expect(container.textContent).not.toContain("Out of range, skipped.");
  });
});
