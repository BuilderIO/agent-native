// @vitest-environment happy-dom

import type {
  ContentDatabaseItem,
  ContentDatabaseItemLayout,
  DocumentProperty,
} from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatabaseLayoutListRow } from "./ListItemRow";

const reviewUrl = "https://content.agent-native.com/page/7n4Q5pN4U9J2";

const reviewProperty: DocumentProperty = {
  definition: {
    id: "review",
    databaseId: "database",
    name: "Review document",
    type: "url",
    visibility: "always_show",
    options: {},
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  value: reviewUrl,
  editable: true,
};

const item = {
  id: "item",
  document: { id: "page", title: "Make Clips quiet", icon: null },
  properties: [reviewProperty],
  excerpt: "",
} as unknown as ContentDatabaseItem;

describe("list rows with a web address", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onPreview = vi.fn();

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    onPreview.mockReset();
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  function renderRow(editing: boolean) {
    act(() => {
      root.render(
        <DatabaseLayoutListRow
          row={{
            layout: {} as ContentDatabaseItemLayout,
            resolved: {
              leading: { kind: "page_icon", property: null },
              titleWeight: "medium",
              line2: { property: null, pageText: false, lines: 1 },
              line3: [reviewProperty],
              trailing: [],
            },
            properties: [reviewProperty],
            editing,
            onLayoutChange: () => {},
            onToggleCheckbox: () => {},
          }}
          isFirst
          item={item}
          databaseDocumentId="database-page"
          canEdit
          onPreview={onPreview}
          actions={null}
        />,
      );
    });
  }

  it("opens the address from its link and the page from the rest of the row", () => {
    renderRow(false);
    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.getAttribute("href")).toBe(reviewUrl);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.closest("button")).toBeNull();

    act(() => {
      link?.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
      });
      link?.click();
    });
    expect(onPreview).not.toHaveBeenCalled();

    act(() => link?.parentElement?.click());
    expect(onPreview).toHaveBeenCalledTimes(1);

    const title = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Make Clips quiet",
    );
    act(() => title?.click());
    expect(onPreview).toHaveBeenCalledTimes(2);
  });

  it("shows the address as text while the row's layout is being edited", () => {
    renderRow(true);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain(reviewUrl);
  });
});
