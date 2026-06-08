// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanBlock } from "@shared/plan-content";
import { PlanBlockView } from "./DocumentArea";

/**
 * Regression guard for the implementation-map ("Files to touch") selection bug:
 * a single file legitimately appears in several rows (one workflow file touched
 * three different ways). The block used to key the active row AND the React list
 * key on `file.path`, so every row sharing a path highlighted together and
 * selected as one. Selection is now tracked by index, which is always unique.
 *
 * `implementation-map` is NOT in the block registry, so `PlanBlockView` renders
 * the legacy block even with no `BlockRegistryProvider` mounted here.
 */

const SELECTED_CLASS = "bg-primary/10";

function railButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      "button[data-plan-interactive]",
    ),
  );
}

function selectedIndexes(buttons: HTMLButtonElement[]): number[] {
  return buttons
    .map((button, index) =>
      button.className.includes(SELECTED_CLASS) ? index : -1,
    )
    .filter((index) => index >= 0);
}

describe("ImplementationMapBlock selection", () => {
  let container: HTMLDivElement;
  let root: Root;

  const block = {
    id: "impl-1",
    type: "implementation-map",
    data: {
      files: [
        {
          path: ".github/workflows/pr-visual-recap.yml",
          title: "Rewrite the recap job",
          note: "NOTE_REWRITE",
        },
        {
          path: ".github/workflows/pr-visual-recap.yml",
          title: "Backend branch — Claude",
          note: "NOTE_CLAUDE",
        },
        {
          path: ".github/workflows/pr-visual-recap.yml",
          title: "Backend branch — Codex",
          note: "NOTE_CODEX",
        },
      ],
    },
  } as unknown as PlanBlock;

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

  it("highlights exactly one row even when several rows share a path", () => {
    act(() => {
      root.render(<PlanBlockView block={block} />);
    });

    const buttons = railButtons(container);
    expect(buttons).toHaveLength(3);

    // Only the first row is active to start, despite all three sharing a path.
    expect(selectedIndexes(buttons)).toEqual([0]);
    expect(container.textContent).toContain("NOTE_REWRITE");
    expect(container.textContent).not.toContain("NOTE_CLAUDE");

    // Clicking the second row selects ONLY the second — not every same-path row.
    act(() => {
      buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(selectedIndexes(railButtons(container))).toEqual([1]);
    expect(container.textContent).toContain("NOTE_CLAUDE");
    expect(container.textContent).not.toContain("NOTE_REWRITE");
  });

  it("renders the file note at the shared document body size", () => {
    act(() => {
      root.render(<PlanBlockView block={block} />);
    });

    // The detail note uses the canonical `.plan-doc-body` size so it matches the
    // rest of the document body instead of the old oversized `text-xl`.
    const note = container.querySelector(".plan-doc-body");
    expect(note?.textContent).toContain("NOTE_REWRITE");
  });
});
