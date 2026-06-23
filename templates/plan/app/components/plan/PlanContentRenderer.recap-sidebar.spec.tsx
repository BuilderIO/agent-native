// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanContent } from "@shared/plan-content";
import { PlanContentRenderer } from "./PlanContentRenderer";
import {
  setWireframeStyle,
  toggleWireframeStyle,
} from "./wireframe/use-wireframe-style";

/**
 * Recap changed-files wiring. The first `file-tree` block stays inline in the
 * document so it remains the editable source of truth and is never dropped on
 * save. Screenshot/export mode can still hide the changed-files block and its
 * standalone heading so generated PR recap screenshots stay focused.
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

function recapWireframeContent(): PlanContent {
  return {
    version: 2,
    title: "Visual recap",
    brief: "brief",
    blocks: [
      {
        id: "wf-1",
        type: "wireframe",
        title: "Private plan",
        data: {
          surface: "popover",
          html: "<h2>Private plan</h2><p>This plan is private.</p>",
        },
      },
    ],
  } as unknown as PlanContent;
}

function recapWideLayoutContent(): PlanContent {
  return {
    version: 2,
    title: "Visual recap",
    brief: "brief",
    blocks: [
      {
        id: "tree-1",
        type: "file-tree",
        title: "Files changed",
        data: {
          title: "Files changed",
          entries: [
            { path: "packages/core/src/a.ts", change: "modified" },
            {
              path: "templates/plan/app/pages/PlansPage.tsx",
              change: "modified",
              note: "Updated the document layout.",
            },
          ],
        },
      },
      {
        id: "intro",
        type: "rich-text",
        data: { markdown: "## Intro\n\nThe narrow reading copy stays here." },
      },
      {
        id: "api-1",
        type: "api-endpoint",
        title: "Plan generation action",
        data: {
          method: "POST",
          path: "/_agent-native/actions/create-visual-plan",
          summary: "API blocks stay in the standard document column.",
        },
      },
      {
        id: "diff-1",
        type: "diff",
        title: "Key diff",
        data: {
          filename: "templates/plan/app/pages/PlansPage.tsx",
          before: "const layout = 'narrow';\n",
          after: "const layout = 'wide';\n",
        },
      },
      {
        id: "after-wide",
        type: "rich-text",
        data: { markdown: "## After wide\n\nLinks still resolve down here." },
      },
    ],
  } as unknown as PlanContent;
}

function rtlContent(): PlanContent {
  return {
    version: 2,
    title: "طرح فارسی",
    brief: "مرور تغییرات با چند عبارت انگلیسی مثل API.",
    blocks: [
      {
        id: "rt-rtl",
        type: "rich-text",
        data: {
          markdown:
            "## مرحله اول\n\nاین متن شامل `Option::get($id)` و یک فهرست است.\n\n- مورد اول",
        },
      },
    ],
  } as unknown as PlanContent;
}

function annotatedCodeContent(): PlanContent {
  return {
    version: 2,
    title: "Annotated code",
    brief: "brief",
    blocks: [
      {
        id: "code-1",
        type: "annotated-code",
        title: "Storage gate",
        data: {
          filename: "templates/clips/app/routes/record.tsx",
          language: "tsx",
          code: [
            "const status = await fetchVideoStorageStatus();",
            "if (!status.configured) {",
            "  throw new Error('No video storage configured.');",
            "}",
          ].join("\n"),
          annotations: [
            {
              lines: "1-2",
              label: "Storage check",
              note: "This should appear on hover, not as an always-open margin card.",
            },
          ],
        },
      },
    ],
  } as unknown as PlanContent;
}

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

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("PlanContentRenderer recap changed files", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    setWireframeStyle("sketchy");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document
      .querySelectorAll(
        "[data-annotation-hover-card],[data-annotation-inline-overlay]",
      )
      .forEach((node) => node.remove());
    vi.unstubAllGlobals();
  });

  it("sets document direction from Persian plan content", () => {
    act(() => {
      root.render(
        <PlanContentRenderer
          content={rtlContent()}
          editingDisabled
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    const article = container.querySelector<HTMLElement>(
      "[data-plan-document]",
    );
    const shell = container.querySelector<HTMLElement>(".plan-document-shell");
    const prose = container.querySelector<HTMLElement>(".an-rich-md-prose");

    expect(article?.dataset.planDirection).toBe("rtl");
    expect(shell?.getAttribute("dir")).toBe("rtl");
    expect(prose?.getAttribute("dir")).toBe("rtl");
  });

  it("keeps annotated-code notes closed until hover in normal plan rendering", () => {
    act(() => {
      root.render(
        <PlanContentRenderer
          content={annotatedCodeContent()}
          editingDisabled
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    expect(
      document.querySelector("[data-annotation-inline-overlay]"),
    ).toBeNull();
    expect(document.querySelector("[data-annotation-hover-card]")).toBeNull();

    const codeSurface = container.querySelector<HTMLElement>(
      "[data-code-surface]",
    )?.parentElement;
    const firstLine = container.querySelector<HTMLElement>(
      '[data-code-line="1"]',
    );
    expect(codeSurface).not.toBeNull();
    expect(firstLine).not.toBeNull();

    stubRect(codeSurface!, rect({ top: 80, height: 110 }));
    stubRect(firstLine!, rect({ top: 104, height: 22 }));

    act(() => {
      firstLine!.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });

    const hoverCard = document.querySelector<HTMLElement>(
      "[data-annotation-hover-card]",
    );
    expect(hoverCard).not.toBeNull();
    expect(hoverCard?.textContent).toContain(
      "This should appear on hover, not as an always-open margin card.",
    );
  });

  it("keeps the first file-tree inline and does not render a read-only files rail", () => {
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

    expect(container.querySelector(".plan-document-files")).toBeNull();
    expect(
      container.querySelector('[data-block-id="tree-1__aside"]'),
    ).toBeNull();

    // The original stays in the document flow (editable source of truth).
    const flow = container.querySelector(".plan-document-flow");
    expect(flow?.querySelector('[data-block-id="tree-1"]')).not.toBeNull();
    const styles = Array.from(container.querySelectorAll("style"))
      .map((node) => node.textContent ?? "")
      .join("\n");
    expect(styles).not.toContain('[data-block-id="tree-1"]');

    // The contents rail keeps the inline file tree and prose sections.
    const toc = container.querySelector(".plan-document-toc");
    expect(toc).not.toBeNull();
    expect(toc?.textContent).toContain("Files changed");
    expect(toc?.textContent).toContain("Section A");
    expect(toc?.textContent).toContain("Section B");
  });

  it("defaults to wide layout and moves blocks from the first wide component into a breakout zone", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    act(() => {
      root.render(
        <PlanContentRenderer
          content={recapWideLayoutContent()}
          isRecap
          editingDisabled
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    const article = container.querySelector<HTMLElement>(
      "[data-plan-document]",
    );
    expect(article?.dataset.planLayout).toBe("wide");

    const body = container.querySelector<HTMLElement>(".plan-document-body");
    const wideZone = container.querySelector<HTMLElement>(
      ".plan-document-flow--wide-zone",
    );
    expect(body).not.toBeNull();
    expect(wideZone).not.toBeNull();

    const mainFlow = container.querySelector<HTMLElement>(
      ".plan-document-flow:not(.plan-document-flow--wide-zone)",
    );
    expect(mainFlow).not.toBeNull();
    expect(mainFlow?.querySelector('[data-block-id="tree-1"]')).not.toBeNull();
    expect(mainFlow?.querySelector('[data-block-id="intro"]')).not.toBeNull();
    expect(mainFlow?.querySelector('[data-block-id="api-1"]')).not.toBeNull();
    expect(
      mainFlow?.querySelector(
        '.plan-document-flow-block[data-block-type="api-endpoint"][data-wide-layout-block]',
      ),
    ).toBeNull();
    expect(mainFlow?.querySelector('[data-block-id="diff-1"]')).toBeNull();
    expect(wideZone?.closest(".plan-document-body")).toBe(body);
    expect(wideZone?.querySelector('[data-block-id="diff-1"]')).not.toBeNull();
    expect(
      wideZone?.querySelector(
        '.plan-document-flow-block[data-block-type="diff"][data-wide-layout-block]',
      ),
    ).not.toBeNull();
    expect(
      wideZone?.querySelector('[data-block-id="after-wide"]'),
    ).not.toBeNull();

    const afterWideLink = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(".plan-document-toc__link"),
    ).find((link) => link.textContent?.trim() === "After wide");
    expect(afterWideLink).toBeDefined();

    act(() => {
      afterWideLink?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("sizes wide recap blocks from the document container, not the viewport", () => {
    const css = readFileSync(join(process.cwd(), "app/global.css"), "utf8");

    expect(css).toContain("@container plan-doc (min-width: 64rem)");
    expect(css).toContain(
      "--plan-wide-component-width: min(1560px, calc(100cqw - 5rem));",
    );
    expect(css).not.toContain(
      "--plan-wide-component-width: min(1560px, calc(100vw - 5rem));",
    );
  });

  it("scrolls inline recap file rows to matching wide diff blocks", () => {
    const scrolledElements: HTMLElement[] = [];
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value(this: HTMLElement) {
        scrolledElements.push(this);
      },
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    act(() => {
      root.render(
        <PlanContentRenderer
          content={recapWideLayoutContent()}
          isRecap
          editingDisabled
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    const fileRow = container.querySelector<HTMLButtonElement>(
      'button[data-file-path="templates/plan/app/pages/PlansPage.tsx"]',
    );
    expect(fileRow).not.toBeNull();
    expect(fileRow?.disabled).toBe(false);

    act(() => {
      fileRow?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    const target = scrolledElements[scrolledElements.length - 1];
    expect(target?.getAttribute("data-block-id")).toBe("diff-1");
    expect(target?.closest(".plan-document-flow--wide-zone")).not.toBeNull();
  });

  it("resolves direct hash links into the wide breakout zone", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    window.location.hash = "#plan-heading-after-wide-0";

    act(() => {
      root.render(
        <PlanContentRenderer
          content={recapWideLayoutContent()}
          isRecap
          editingDisabled
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    });

    const target = container.querySelector<HTMLElement>(
      "#plan-heading-after-wide-0",
    );
    expect(target?.textContent).toContain("After wide");
    expect(target?.closest(".plan-document-flow--wide-zone")).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalled();
    window.location.hash = "";
  });

  it("syncs the clean/sketchy preference into core-rendered recap wireframes", () => {
    act(() => {
      root.render(
        <PlanContentRenderer
          content={recapWireframeContent()}
          isRecap
          editingDisabled
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    const frame = container.querySelector<HTMLElement>(".plan-html-frame");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("data-style")).toBe("sketchy");

    act(() => {
      toggleWireframeStyle();
    });

    expect(frame?.getAttribute("data-style")).toBe("clean");
  });

  it("renders recap wireframe artboards without decorative shadows", () => {
    act(() => {
      root.render(
        <PlanContentRenderer
          content={recapWireframeContent()}
          isRecap
          editingDisabled
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    const artboard = container.querySelector<HTMLElement>(".plan-kit-artboard");
    expect(artboard).not.toBeNull();
    expect(artboard?.style.boxShadow).toBe("");
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

  it("does not reserve a contents rail when hidden changed-files content leaves one section", () => {
    // Screenshot/export mode hides the "Files changed" heading + file-tree. The
    // contents nav should count what's LEFT (one real section) — not enough for a
    // rail. `data-has-toc` must stay absent so the grid reserves no empty TOC
    // column, and PlanTableOfContents renders neither rail nor accordion.
    const content = {
      version: 2,
      title: "Recap",
      brief: "brief",
      blocks: [
        {
          id: "files-h",
          type: "rich-text",
          data: { markdown: "## Files changed" },
        },
        {
          id: "tree-1",
          type: "file-tree",
          title: "Files changed",
          data: { entries: [{ path: "a.ts", change: "modified" }] },
        },
        {
          id: "rt-only",
          type: "rich-text",
          data: { markdown: "## Overview\n\nbody" },
        },
      ],
    } as unknown as PlanContent;

    act(() => {
      root.render(
        <PlanContentRenderer
          content={content}
          isRecap
          editingDisabled
          hideChangedFiles
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    const body = container.querySelector<HTMLElement>(".plan-document-body");
    expect(body?.hasAttribute("data-has-toc")).toBe(false);
    expect(container.querySelector(".plan-document-toc")).toBeNull();
    expect(container.querySelector(".plan-document-toc-inline")).toBeNull();
  });

  it("leaves non-recap plans editable in-flow instead of moving file trees to a read-only rail", () => {
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
          sourceUrl="https://github.com/BuilderIO/ai-services/pull/5385"
          fallbackTitle="Untitled plan"
          fallbackBrief=""
        />,
      );
    });

    expect(container.querySelector(".plan-document-files")).toBeNull();
    expect(container.querySelector(".plan-document-toc")).toBeNull();
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
