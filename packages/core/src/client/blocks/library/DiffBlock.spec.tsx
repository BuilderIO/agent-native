// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffRead, diffLines } from "./DiffBlock.js";
import { NarrowContainerProvider } from "./narrow-container.js";

const DIFF_MODE_STORAGE_KEY = "agent-native:diff-view-mode";

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
    vi.unstubAllGlobals();
  });

  function renderDiff({
    before = "",
    after,
    blockId = "diff-1",
    filename = "src/example.ts",
    language,
    mode,
  }: {
    before?: string;
    after: string;
    blockId?: string;
    filename?: string;
    language?: string;
    mode?: "unified" | "split";
  }) {
    act(() => {
      root.render(
        <DiffRead
          key={blockId}
          blockId={blockId}
          ctx={{}}
          data={{ before, after, filename, language, mode }}
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

  it("defaults to unified (single column) when no mode is authored", () => {
    renderDiff({ after: "const a = 1\nconst b = 2" });

    // Unified renders ONE code column — none of split's `border-r` divider
    // columns — and exposes the Unified/Split toggle so the user can still
    // switch to side-by-side.
    expect(container.querySelector(".border-r.border-border")).toBeNull();
    const splitToggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Split",
    );
    expect(splitToggle).toBeTruthy();
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

    // Starts unified (no split divider).
    expect(container.querySelector(".border-r.border-border")).toBeNull();

    const splitToggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Split",
    );
    expect(splitToggle).toBeTruthy();
    act(() => {
      splitToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    // Toggling to Split produces the side-by-side columns.
    expect(container.querySelector(".border-r.border-border")).toBeTruthy();

    const unifiedToggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Unified",
    );
    act(() => {
      unifiedToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    // …and back to unified.
    expect(container.querySelector(".border-r.border-border")).toBeNull();
  });

  it("persists the selected layout and applies it to future diff blocks", () => {
    renderDiff({
      before: "const a = 1",
      after: "const a = 2",
      blockId: "diff-persist-first",
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

    renderDiff({
      before: "const b = 1",
      after: "const b = 2",
      blockId: "diff-persist-next",
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
  });

  it("defaults an unspecified diff to unified inside a narrow container", () => {
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

    // No authored mode + narrow container ⇒ unified up front, and the toggle is
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
    vi.unstubAllGlobals();
  });

  function render(data: {
    before: string;
    after: string;
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
          blockId="diff-anno"
          ctx={{}}
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
