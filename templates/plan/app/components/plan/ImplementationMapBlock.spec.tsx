// @vitest-environment happy-dom

import { BlockRegistryProvider } from "@agent-native/core/blocks";
import type { PlanBlock } from "@shared/plan-content";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanBlockView } from "./DocumentArea";
import { createPlanBlockRenderContext, planBlockRegistry } from "./planBlocks";

/**
 * Contract guard for the deprecated `implementation-map` block: `PlanBlockView`
 * display-converts it to a `file-tree` block at render time (storage stays
 * intact — no write-back), so old stored plans get the modern file explorer
 * instead of the retired two-pane layout.
 *
 * This also preserves the spirit of the original selection regression: a single
 * file legitimately appears in several rows (one workflow file touched three
 * different ways). The legacy block once keyed selection on `file.path`, so
 * same-path rows selected together. The file-tree keys per-row disclosure on the
 * flat entry INDEX, so duplicate paths stay independent rows.
 *
 * `file-tree` renders through the block registry, so the spec mounts
 * `BlockRegistryProvider` with the real plan registry — the same way
 * `PlanContentRenderer` mounts it in the app.
 */

function fileRowButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button[data-file-path]"),
  );
}

function expandedRowIndexes(buttons: HTMLButtonElement[]): number[] {
  return buttons
    .map((button, index) =>
      button.getAttribute("aria-expanded") === "true" ? index : -1,
    )
    .filter((index) => index >= 0);
}

describe("implementation-map display-time conversion to file-tree", () => {
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
          snippet: "name: Recap rewrite",
        },
        {
          path: ".github/workflows/pr-visual-recap.yml",
          title: "Backend branch — Claude",
          note: "NOTE_CLAUDE",
          snippet: "name: Recap Claude",
        },
        {
          path: ".github/workflows/pr-visual-recap.yml",
          title: "Backend branch — Codex",
          note: "NOTE_CODEX",
          snippet: "name: Recap Codex",
        },
      ],
    },
  } as unknown as PlanBlock;

  function renderBlock() {
    act(() => {
      root.render(
        <BlockRegistryProvider
          registry={planBlockRegistry}
          ctx={createPlanBlockRenderContext({})}
        >
          <PlanBlockView block={block} />
        </BlockRegistryProvider>,
      );
    });
  }

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

  it("renders as a file-tree with one row per entry, even when rows share a path", () => {
    renderBlock();

    // The conversion keeps the block id and renders the file-tree explorer —
    // never the "Unsupported block" placeholder.
    const section = container.querySelector('[data-block-id="impl-1"]');
    expect(section).not.toBeNull();
    expect(container.textContent).not.toContain("Unsupported block");

    // Three same-path files stay three distinct rows (index-keyed, not
    // path-keyed), and each carries its note.
    const rows = fileRowButtons(container);
    expect(rows).toHaveLength(3);
    expect(container.textContent).toContain("3 files");
    expect(container.textContent).toContain("NOTE_REWRITE");
    expect(container.textContent).toContain("NOTE_CLAUDE");
    expect(container.textContent).toContain("NOTE_CODEX");
  });

  it("expands exactly one row's detail even when several rows share a path", () => {
    renderBlock();

    const rows = fileRowButtons(container);
    expect(rows).toHaveLength(3);

    // All rows start collapsed.
    expect(expandedRowIndexes(rows)).toEqual([]);

    // Clicking the second row expands ONLY the second — not every same-path row.
    act(() => {
      rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const afterClick = fileRowButtons(container);
    expect(expandedRowIndexes(afterClick)).toEqual([1]);

    // The expanded detail paragraph carries the second row's note.
    const detail = Array.from(container.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("NOTE_CLAUDE"),
    );
    expect(detail).toBeDefined();
  });
});
