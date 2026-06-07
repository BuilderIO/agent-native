// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTreeRead } from "./FileTreeBlock.js";
import type { FileTreeEntry } from "./file-tree.config.js";

describe("FileTreeBlock", () => {
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

  function renderFileTree(entries: FileTreeEntry[]) {
    act(() => {
      root.render(
        <FileTreeRead
          blockId="file-tree-1"
          ctx={{}}
          data={{ title: "Changed surfaces", entries }}
        />,
      );
    });
  }

  it("compacts single-child folder chains into one folder row", () => {
    renderFileTree([
      {
        path: "packages/core/src/client/blocks/library/file-tree.tsx",
        change: "modified",
      },
      {
        path: "packages/core/src/client/blocks/library/file-tree.spec.tsx",
        change: "added",
      },
    ]);

    const folderLabels = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).map((button) => button.textContent ?? "");

    expect(folderLabels).toContain("packages/core/src/client/blocks/library");
    expect(folderLabels).not.toContain("packages");
    expect(container.textContent).toContain("file-tree.tsx");
    expect(container.textContent).toContain("file-tree.spec.tsx");
  });

  it("limits the initial tree to ten rows and can expand to all rows", () => {
    renderFileTree(
      Array.from({ length: 12 }, (_, index) => ({
        path: `file-${String(index + 1).padStart(2, "0")}.ts`,
        change: "modified",
      })),
    );

    expect(container.textContent).toContain("file-10.ts");
    expect(container.textContent).not.toContain("file-11.ts");

    const showAll = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Show all 12 rows",
    );
    expect(showAll).toBeTruthy();

    act(() => {
      showAll?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(container.textContent).toContain("file-11.ts");
    expect(container.textContent).toContain("file-12.ts");
    expect(container.textContent).toContain("Show fewer");
  });

  it("uses muted folder icon colors", () => {
    renderFileTree([
      { path: "src/routes/index.ts", change: "modified" },
      { path: "src/routes/settings.ts", change: "modified" },
    ]);

    expect(container.innerHTML).toContain("text-plan-muted");
    expect(container.innerHTML).not.toContain("text-amber");
  });

  it("uses the same UI typography for folder and file labels", () => {
    renderFileTree([{ path: "src/index.ts", change: "modified" }]);

    const labels = Array.from(container.querySelectorAll("span"));
    const folderLabel = labels.find((span) => span.textContent === "src");
    const fileLabel = labels.find((span) => span.textContent === "index.ts");

    expect(folderLabel?.className).toContain("font-medium");
    expect(fileLabel?.className).toContain("font-medium");
    expect(fileLabel?.className).not.toContain("font-mono");
  });
});
