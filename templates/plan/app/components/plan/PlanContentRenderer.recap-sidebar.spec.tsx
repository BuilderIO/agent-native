// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanContent } from "@shared/plan-content";
import { PlanContentRenderer } from "./PlanContentRenderer";

/**
 * Recap "Files touched" sidebar wiring. On wide recap screens the first
 * `file-tree` block is mirrored into a permanent left sidebar
 * (`.plan-document-files`) while the in-flow copy is hidden via an injected,
 * breakpoint-scoped rule — so the block stays the editable source of truth and is
 * never dropped on save. The mirror carries a distinct `…__aside` id so it never
 * collides with (or gets hidden by) the original, and the relocated block drops
 * out of the contents rail (its in-flow anchor is hidden and unscrollable).
 *
 * Read-mode is rendered here (no persistence handler ⇒ no Tiptap editor), which
 * is the per-block path; the editable path hides the same block via the same
 * descendant rule.
 */

function recapContent(): PlanContent {
  return {
    version: 2,
    title: "Visual recap",
    brief: "brief",
    blocks: [
      {
        id: "tree-1",
        type: "file-tree",
        // Both heading sources set with a stats-laden authored title — the real
        // recap shape that produced the duplicated heading: `title` renders as the
        // greyed eyebrow, `data.title` as the bold summary header, stacked.
        title: "Files changed (+1529 / -534, 9 files)",
        data: {
          title: "Files changed (+1529 / -534, 9 files)",
          entries: [
            {
              path: "packages/core/src/a.ts",
              change: "modified",
              note: "touched a thing",
            },
          ],
        },
      },
      {
        id: "rt-a",
        type: "rich-text",
        data: { markdown: "## Section A\n\nbody" },
      },
      {
        id: "rt-b",
        type: "rich-text",
        data: { markdown: "## Section B\n\nbody" },
      },
    ],
  } as unknown as PlanContent;
}

describe("PlanContentRenderer recap files sidebar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("mirrors the first file-tree into a left sidebar and omits it from the contents", () => {
    act(() => {
      root.render(
        <PlanContentRenderer
          content={recapContent()}
          isRecap
          editingDisabled
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    // The left sidebar exists and shows the relocated block.
    const aside = container.querySelector(".plan-document-files");
    expect(aside).not.toBeNull();

    // The sidebar shows exactly ONE file-tree heading, and it reads the fixed
    // "Files changed" label — NOT the authored title and NOT the stats suffix.
    // The two heading sources are: the eyebrow `.plan-block-label` (from
    // `block.title`) and the file-tree's bold summary header (from `data.title`).
    // Both must be stripped from the mirrored block; only the sidebar's own
    // `.plan-document-files__label` remains.
    expect(aside?.querySelectorAll(".plan-block-label").length).toBe(0);
    const sidebarLabels = aside?.querySelectorAll(
      ".plan-document-files__label",
    );
    expect(sidebarLabels?.length).toBe(1);
    expect(sidebarLabels?.[0]?.textContent?.trim()).toBe("Files changed");
    // No stats suffix anywhere in the sidebar heading text.
    expect(aside?.textContent).not.toContain("+1529");
    expect(aside?.textContent).not.toContain("9 files)");
    // The authored title string never appears verbatim in the sidebar.
    expect(aside?.textContent).not.toContain(
      "Files changed (+1529 / -534, 9 files)",
    );

    // The mirror uses a distinct id so it never duplicates / collides with the
    // original's `data-block-id`.
    expect(
      container.querySelector('[data-block-id="tree-1__aside"]'),
    ).not.toBeNull();

    // The original stays in the document flow (editable source of truth).
    const flow = container.querySelector(".plan-document-flow");
    expect(flow?.querySelector('[data-block-id="tree-1"]')).not.toBeNull();

    // A breakpoint-scoped rule hides the in-flow copy at wide widths.
    const styles = Array.from(container.querySelectorAll("style"))
      .map((node) => node.textContent ?? "")
      .join("\n");
    expect(styles).toContain('[data-block-id="tree-1"]');
    expect(styles).toContain("display:none");
    expect(styles).toContain("min-width: 1400px");

    // The contents rail drops the relocated block but keeps the prose sections.
    const toc = container.querySelector(".plan-document-toc");
    expect(toc).not.toBeNull();
    expect(toc?.textContent).toContain("Section A");
    expect(toc?.textContent).toContain("Section B");
    expect(toc?.textContent).not.toContain("Files changed");
  });

  it("links GitHub PR references in the read-only recap brief", () => {
    const content = {
      ...recapContent(),
      brief: "Recap of BuilderIO/ai-services#5024 — adds a session endpoint.",
    };

    act(() => {
      root.render(
        <PlanContentRenderer
          content={content}
          isRecap
          editingDisabled
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    const link = container.querySelector<HTMLAnchorElement>(
      'header a[href="https://github.com/BuilderIO/ai-services/pull/5024"]',
    );
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("BuilderIO/ai-services#5024");
    expect(link?.target).toBe("_blank");
    expect(container.querySelector("header")?.textContent).toContain(
      "Recap of BuilderIO/ai-services#5024 — adds a session endpoint.",
    );
  });

  it("shows recap source and file stats in one header row outside screenshot mode", () => {
    const content = recapContent();
    const fileTree = content.blocks[0];
    if (fileTree?.type === "file-tree") {
      fileTree.data.entries.push({
        path: "packages/core/src/b.ts",
        change: "added",
      });
    }

    act(() => {
      root.render(
        <PlanContentRenderer
          content={content}
          isRecap
          editingDisabled
          sourceUrl="https://github.com/BuilderIO/ai-services/pull/5385"
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    const sourceLink = container.querySelector<HTMLAnchorElement>(
      'header a[href="https://github.com/BuilderIO/ai-services/pull/5385"]',
    );
    const stats = container.querySelector<HTMLElement>(
      'header [aria-label="Change statistics"]',
    );
    expect(sourceLink?.textContent).toBe("BuilderIO/ai-services#5385");
    expect(stats?.textContent).toBe("2 files · +1");
    expect(sourceLink?.parentElement).toBe(stats?.parentElement);
  });

  it("leaves non-recap plans unchanged (no files sidebar, no hide style)", () => {
    act(() => {
      root.render(
        <PlanContentRenderer
          content={recapContent()}
          editingDisabled
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    expect(container.querySelector(".plan-document-files")).toBeNull();
    const flow = container.querySelector(".plan-document-flow");
    expect(flow?.querySelector('[data-block-id="tree-1"]')).not.toBeNull();
    const styles = Array.from(container.querySelectorAll("style"))
      .map((node) => node.textContent ?? "")
      .join("\n");
    expect(styles).not.toContain('[data-block-id="tree-1"]');
  });

  it("can hide recap chrome, changed files, and contents for screenshot mode", () => {
    const content = recapContent();
    content.blocks.unshift({
      id: "read-write",
      type: "rich-text",
      data: {
        markdown:
          "## Read & write paths\n\nHostname is persisted once.\n\n### Changed files",
      },
    });
    content.blocks.push({
      id: "rt-c",
      type: "rich-text",
      data: { markdown: "## Section C\n\nbody" },
    });

    act(() => {
      root.render(
        <PlanContentRenderer
          content={content}
          isRecap
          editingDisabled
          hideChangedFiles
          hideRecapChrome
          hideFloatingToc
          sourceUrl="https://github.com/BuilderIO/ai-services/pull/5385"
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    expect(container.querySelector(".plan-document-files")).toBeNull();
    expect(container.querySelector(".plan-document-toc")).toBeNull();
    expect(container.querySelector(".plan-toc-fallback")).toBeNull();
    expect(
      Array.from(container.querySelectorAll("header p")).some(
        (node) => node.textContent?.trim() === "Visual Recap",
      ),
    ).toBe(false);
    expect(
      container.querySelector(
        'header a[href="https://github.com/BuilderIO/ai-services/pull/5385"]',
      ),
    ).toBeNull();
    expect(container.querySelector('[data-block-id="tree-1"]')).toBeNull();
    expect(
      container.querySelector('[data-block-id="read-write"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Read & write paths");
    expect(container.textContent).not.toContain(
      "Files changed (+1529 / -534, 9 files)",
    );
    expect(container.textContent).not.toContain("Changed files");
    expect(container.textContent).not.toContain("packages/core/src/a.ts");

    expect(container.textContent).not.toContain("On this recap");
  });
});
