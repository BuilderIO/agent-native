// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffRead, diffLines } from "./DiffBlock.js";

describe("DiffBlock", () => {
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
    vi.unstubAllGlobals();
  });

  function renderDiff({
    after,
    filename = "src/example.ts",
    language,
    mode = "unified",
  }: {
    after: string;
    filename?: string;
    language?: string;
    mode?: "unified" | "split";
  }) {
    act(() => {
      root.render(
        <DiffRead
          blockId="diff-1"
          ctx={{}}
          data={{ before: "", after, filename, language, mode }}
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
