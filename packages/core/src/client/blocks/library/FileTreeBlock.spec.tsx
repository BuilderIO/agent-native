// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileTreeEntry } from "./file-tree.config.js";
import { FileTreeRead } from "./FileTreeBlock.js";

describe("FileTreeBlock", () => {
  let container: HTMLDivElement;
  let root: Root;

  const restoreElementSizeDescriptor = (
    property: "scrollWidth" | "clientWidth" | "getBoundingClientRect",
    descriptor: PropertyDescriptor | undefined,
  ) => {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, property, descriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, property);
    }
  };

  const mockElementMeasurements = ({
    clientWidth,
    scrollWidth,
  }: {
    clientWidth: number;
    scrollWidth: number;
  }) => {
    const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollWidth",
    );
    const clientWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    const rectDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect",
    );

    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get: () => scrollWidth,
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => clientWidth,
    });
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          bottom: 16,
          height: 16,
          left: 0,
          right: clientWidth,
          top: 0,
          width: clientWidth,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    return () => {
      restoreElementSizeDescriptor("scrollWidth", scrollWidthDescriptor);
      restoreElementSizeDescriptor("clientWidth", clientWidthDescriptor);
      restoreElementSizeDescriptor("getBoundingClientRect", rectDescriptor);
    };
  };

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

  it("does not show file disclosure for note-only files", () => {
    renderFileTree([
      { path: "AGENTS.md", note: "Always-on agent instructions." },
    ]);

    const fileRow = container.querySelector('[data-file-path="AGENTS.md"]');

    expect(fileRow).toBeTruthy();
    expect(fileRow?.tagName).toBe("DIV");
    expect(fileRow?.hasAttribute("aria-expanded")).toBe(false);
    expect(
      fileRow?.querySelector('[class*="tabler-icon-chevron-right"]'),
    ).toBeNull();
    expect(fileRow?.textContent).toContain("Always-on agent instructions.");

    const note = Array.from(fileRow?.querySelectorAll("span") ?? []).find(
      (span) => span.textContent === "Always-on agent instructions.",
    );
    expect(note?.className).toContain("truncate");
    expect(note?.getAttribute("title")).toBeNull();
    expect(note?.getAttribute("data-file-note-overflowing")).toBeNull();
  });

  it("does not treat a zero-width note as truncated", async () => {
    const restoreMeasurements = mockElementMeasurements({
      clientWidth: 0,
      scrollWidth: 240,
    });

    try {
      renderFileTree([
        { path: "AGENTS.md", note: "Always-on agent instructions." },
      ]);

      await act(async () => {});

      const fileRow = container.querySelector('[data-file-path="AGENTS.md"]');
      const note = Array.from(fileRow?.querySelectorAll("span") ?? []).find(
        (span) => span.textContent === "Always-on agent instructions.",
      );

      expect(note?.className).toContain("truncate");
      expect(note?.getAttribute("title")).toBeNull();
      expect(note?.getAttribute("data-file-note-overflowing")).toBeNull();
    } finally {
      restoreMeasurements();
    }
  });

  it("marks the note tooltip as available when text is visibly truncated", async () => {
    const restoreMeasurements = mockElementMeasurements({
      clientWidth: 80,
      scrollWidth: 240,
    });

    try {
      renderFileTree([
        { path: "AGENTS.md", note: "Always-on agent instructions." },
      ]);

      await act(async () => {});

      const fileRow = container.querySelector('[data-file-path="AGENTS.md"]');
      const note = Array.from(fileRow?.querySelectorAll("span") ?? []).find(
        (span) => span.textContent === "Always-on agent instructions.",
      );

      expect(note?.className).toContain("truncate");
      expect(note?.getAttribute("title")).toBeNull();
      expect(note?.getAttribute("data-file-note-overflowing")).toBe("");
    } finally {
      restoreMeasurements();
    }
  });

  it("flags data-files-expanded only while focused with an open file", () => {
    renderFileTree([
      {
        path: "src/index.ts",
        change: "modified",
        note: "Entry point change.",
        snippet: "export const value = 1;",
      },
    ]);

    const section = container.querySelector("section.plan-block");
    const fileButton = Array.from(container.querySelectorAll("button")).find(
      (button) => (button.textContent ?? "").includes("index.ts"),
    );
    expect(section).toBeTruthy();
    expect(fileButton).toBeTruthy();

    const pointerDown = (target: EventTarget) =>
      act(() => {
        target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });
    const click = (target: EventTarget) =>
      act(() => {
        target.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });

    // Collapsed by default — neither focused nor open.
    expect(section?.hasAttribute("data-files-expanded")).toBe(false);
    expect(fileButton?.getAttribute("aria-expanded")).toBe("false");

    // Focus + open the file → expanded.
    pointerDown(fileButton!);
    click(fileButton!);
    expect(section?.hasAttribute("data-files-expanded")).toBe(true);
    expect(fileButton?.getAttribute("aria-expanded")).toBe("true");

    // Clicking elsewhere collapses the rail AND closes the open file.
    pointerDown(document.body);
    expect(section?.hasAttribute("data-files-expanded")).toBe(false);
    expect(fileButton?.getAttribute("aria-expanded")).toBe("false");

    // Re-opening works again; closing the last open file collapses too.
    pointerDown(fileButton!);
    click(fileButton!);
    expect(section?.hasAttribute("data-files-expanded")).toBe(true);
    click(fileButton!);
    expect(section?.hasAttribute("data-files-expanded")).toBe(false);
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
