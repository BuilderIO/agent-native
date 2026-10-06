// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/sidebar-trigger", () => ({
  useSidebarTrigger: () => null,
}));

import {
  STARTUP_PAGE_ICON_ROW_ATTRIBUTE,
  STARTUP_PAGE_SHAPE_ATTRIBUTE,
} from "@/lib/page-startup-hints";

import {
  DOCUMENT_EDITOR_INLINE_REVIEW_MIN_WIDTH,
  documentEditorBodyClassName,
  documentEditorDatabaseRegionClassName,
  documentEditorTitleRegionClassName,
} from "./document-editor-layout";
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
    const title = container.querySelector(".text-3xl.md\\:text-4xl.font-bold");
    expect(title?.textContent).toBe("Quarterly planning notes");
  });

  it("draws the title and body in the editor's own boxes", () => {
    act(() => {
      root.render(<DocumentEditorSkeleton title={null} />);
    });
    const region = container.querySelector(
      '[data-startup-anchor="title"]',
    )?.parentElement;
    expect(region?.className).toBe(documentEditorTitleRegionClassName(false));
    expect(
      container.querySelector('[data-startup-anchor="body"]')?.className,
    ).toBe(documentEditorBodyClassName("page"));
  });

  it("leaves the body out until the title is known", () => {
    act(() => {
      root.render(<DocumentEditorSkeleton />);
    });
    expect(
      container.querySelector('[data-startup-anchor="title"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-startup-anchor="body"]')).toBeNull();
  });

  it("holds the icon row the editor will draw", () => {
    const iconRowHeight = (iconRow?: "icon" | "add" | "none") => {
      act(() => {
        root.render(<DocumentEditorSkeleton iconRow={iconRow} />);
      });
      return container.querySelector('[data-startup-anchor="title"]')
        ?.previousElementSibling?.firstElementChild?.className;
    };
    expect(iconRowHeight()).toBe("h-7");
    expect(iconRowHeight("icon")).toContain("size-14");
    expect(iconRowHeight("none")).toBeUndefined();
  });

  it("sizes the server-drawn icon row from the startup script's mark", () => {
    act(() => {
      root.render(<DocumentEditorSkeleton iconRow="startup" />);
    });
    const row = container.querySelector('[data-startup-anchor="title"]')
      ?.previousElementSibling?.firstElementChild?.className;
    const mark = `html[${STARTUP_PAGE_ICON_ROW_ATTRIBUTE}`;
    expect(row).toContain("h-7");
    expect(row).toContain(`[${mark}=icon]_&]:size-14`);
    expect(row).toContain(`[${mark}=none]_&]:hidden`);
  });

  it("draws a collection in the collection's own boxes", () => {
    act(() => {
      root.render(<DocumentEditorSkeleton title="Tasks" shape="database" />);
    });
    const title = container.querySelector('[data-startup-anchor="title"]');
    expect(title?.parentElement?.className).toBe(
      documentEditorTitleRegionClassName(true),
    );
    expect(title?.className).toContain("text-3xl");
    expect(title?.className).not.toContain("md:text-4xl");
    expect(
      title?.previousElementSibling?.firstElementChild?.className,
    ).toContain("size-14");
    const tabs = container.querySelector(
      '[data-startup-anchor="database-tabs"]',
    );
    expect(tabs?.parentElement?.parentElement?.className).toBe(
      documentEditorDatabaseRegionClassName(),
    );
    expect(container.querySelector('[data-startup-anchor="body"]')).toBeNull();
    expect(tabs?.nextElementSibling?.getAttribute("data-startup-anchor")).toBe(
      "database-table",
    );
  });

  it("holds the sort and filter row a collection last drew", () => {
    act(() => {
      root.render(
        <DocumentEditorSkeleton title="Tasks" shape="database-constrained" />,
      );
    });
    const tabs = container.querySelector(
      '[data-startup-anchor="database-tabs"]',
    );
    expect(tabs?.nextElementSibling?.className).toContain("min-h-8");
    expect(
      tabs?.nextElementSibling?.nextElementSibling?.getAttribute(
        "data-startup-anchor",
      ),
    ).toBe("database-table");
  });

  it("holds the review margin beside a page that last had open comments", () => {
    act(() => {
      root.render(<DocumentEditorSkeleton title="Notes" shape="review" />);
    });
    const column = container.querySelector('[data-startup-anchor="title"]')
      ?.parentElement?.parentElement;
    expect(column?.className).toContain(
      `@min-[${DOCUMENT_EDITOR_INLINE_REVIEW_MIN_WIDTH}px]:pr-80`,
    );
    expect(column?.parentElement?.className).toContain("@container");
  });

  it("draws the server shell from the startup script's shape mark", () => {
    act(() => {
      root.render(<DocumentEditorSkeleton iconRow="startup" shape="startup" />);
    });
    const mark = `html[${STARTUP_PAGE_SHAPE_ATTRIBUTE}`;
    const [pageTitle, databaseTitle] = container.querySelectorAll(
      '[data-startup-anchor="title"]',
    );
    const pageColumn = pageTitle?.parentElement?.parentElement;
    const databaseColumn = databaseTitle?.parentElement?.parentElement;
    expect(pageColumn?.className).toContain(
      `[${mark}=review]_&]:@min-[1088px]:pr-80`,
    );
    expect(pageColumn?.className).toContain(`[${mark}=database]_&]:hidden`);
    expect(databaseColumn?.className).toContain("hidden");
    expect(databaseColumn?.className).toContain(
      `[${mark}=database-constrained]_&]:block`,
    );
  });
});
