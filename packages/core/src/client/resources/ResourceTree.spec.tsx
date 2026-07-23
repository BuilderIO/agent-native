// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResourceTree } from "./ResourceTree.js";

describe("ResourceTree empty state", () => {
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

  it("keeps the action at the section edge without a decorative file icon", () => {
    act(() => {
      root.render(
        <ResourceTree
          tree={[]}
          selectedId={null}
          onSelect={vi.fn()}
          onCreateFile={vi.fn()}
          onCreateFolder={vi.fn()}
          onDelete={vi.fn()}
          onRename={vi.fn()}
          onDrop={vi.fn()}
          title="Personal"
          emptyStateAction={<button type="button">Add file</button>}
        />,
      );
    });

    const message = Array.from(container.querySelectorAll("p")).find(
      (node) => node.textContent === "No files yet",
    );
    const action = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent === "Add file",
    );

    expect(container.querySelector(".tabler-icon-file")).toBeNull();
    expect(message?.className).not.toContain("ps-5");
    expect(action?.parentElement?.className).toContain("mt-4");
    expect(action?.parentElement?.parentElement?.className).toContain("px-2");
  });
});
