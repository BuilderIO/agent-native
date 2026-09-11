// @vitest-environment happy-dom

import type { PlanBlock } from "@shared/plan-content";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PlanBlockView } from "./DocumentArea";

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const IMAGE_BLOCK: PlanBlock = {
  id: "img-1",
  type: "image",
  data: { url: "https://cdn.example.com/cat.png", alt: "A cat", fit: "cover" },
};

/**
 * Renders an editable image block through the legacy dispatcher. This also
 * exercises the `DocumentArea` ↔ `planBlocks` module cycle (the image edit dialog
 * imports `PlanAiBlockAction` from planBlocks), so an import-order regression
 * would surface here.
 */
describe("editable image block", () => {
  it("renders the image with a single self-contained action overlay", () => {
    expect(() => {
      act(() => {
        root.render(<PlanBlockView block={IMAGE_BLOCK} onChange={() => {}} />);
      });
    }).not.toThrow();

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/cat.png");

    // One overlay = zoom + ⋯ (Edit/Replace live inside the ⋯ menu); the block
    // must NOT render a second, separate edit control.
    const actions = container.querySelector(".plan-image__actions");
    expect(actions).toBeTruthy();
    expect(actions!.querySelectorAll("button")).toHaveLength(2);
  });

  it("renders read-only (no action handlers) when not editable", () => {
    act(() => {
      root.render(
        <PlanBlockView
          block={IMAGE_BLOCK}
          editingDisabled
          onChange={() => {}}
        />,
      );
    });

    // Read-only still shows the image; the overlay is the same shared component.
    expect(container.querySelector("img")).toBeTruthy();
  });
});
