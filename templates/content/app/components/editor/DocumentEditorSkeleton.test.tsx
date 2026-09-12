// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/sidebar-trigger", () => ({
  useSidebarTrigger: () => null,
}));

import { DocumentEditorSkeleton } from "./DocumentEditorSkeleton";

describe("DocumentEditorSkeleton optimistic title", () => {
  let container: HTMLDivElement;
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

  it("keeps the layout-matching title bar when no title is known", () => {
    act(() => {
      root.render(<DocumentEditorSkeleton />);
    });
    expect(container.textContent).not.toContain("Quarterly planning notes");
    expect(
      container.querySelectorAll(".skeleton-shimmer").length,
    ).toBeGreaterThan(0);
  });

  it("renders the known title with the editor title typography", () => {
    act(() => {
      root.render(<DocumentEditorSkeleton title="Quarterly planning notes" />);
    });
    const title = container.querySelector(
      ".text-3xl.md\\:text-4xl.font-bold.leading-tight",
    );
    expect(title?.textContent).toBe("Quarterly planning notes");
  });
});
