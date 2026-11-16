// @vitest-environment happy-dom

import type { ContentDatabaseItem } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drawn = vi.hoisted(() => ({
  toolbar: null as Record<string, unknown> | null,
  properties: null as Record<string, unknown> | null,
}));

vi.mock("./DocumentToolbar", () => ({
  DocumentToolbar: (props: Record<string, unknown>) => {
    drawn.toolbar = props;
    return <div data-testid="toolbar" />;
  },
}));
vi.mock("./DocumentProperties", () => ({
  DocumentProperties: (props: Record<string, unknown>) => {
    drawn.properties = props;
    return <div data-testid="properties" />;
  },
}));
vi.mock("../icons/ContentIcon", () => ({
  ContentIcon: ({ value }: { value: string }) => <span>{value}</span>,
}));

import type { DatabaseRowView } from "./database/row-view-layout";
import { DatabaseItemPreviewPlaceholder } from "./DatabaseItemPreviewPlaceholder";
import {
  DOCUMENT_EDITOR_DATABASE_TITLE_SIZE_CLASS_NAME,
  documentEditorBodyClassName,
  documentEditorTitleRegionClassName,
} from "./document-editor-layout";

function row(document: Record<string, unknown>, open = 0) {
  return {
    id: "item-1",
    databaseId: "database",
    document: { id: "row-1", title: "Launch plan", canEdit: true, ...document },
    properties: [],
    comments: { open },
  } as unknown as ContentDatabaseItem;
}

describe("a row's panel while its page is read", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    drawn.toolbar = null;
    drawn.properties = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function draw(
    item: ContentDatabaseItem,
    collectionEditable = true,
    rowView?: DatabaseRowView,
  ) {
    act(() => {
      root.render(
        <DatabaseItemPreviewPlaceholder
          row={{ item, collectionEditable }}
          documentId={item.document.id}
          databaseId="database"
          databaseDocumentId="database-page"
          rowView={rowView}
        />,
      );
    });
    const placeholder = container.querySelector<HTMLElement>(
      "[data-database-item-preview-placeholder]",
    );
    if (!placeholder) throw new Error("The placeholder didn't draw");
    return placeholder;
  }

  it("draws the toolbar the page will use, with the row's own count", () => {
    draw(row({}, 3));
    expect(drawn.toolbar).toMatchObject({
      compact: true,
      documentId: "row-1",
      documentTitle: "Launch plan",
      canEdit: true,
      openCommentCount: 3,
      utilityPanel: null,
    });
  });

  it("holds the toolbar's Comments button back from a row that can't comment", () => {
    draw(row({ canComment: false }));
    expect(drawn.toolbar).toMatchObject({ showCommentsControl: false });
  });

  it("draws the title, Properties and body in the page's own boxes", () => {
    const placeholder = draw(row({}));
    const region = placeholder.querySelector(
      `[class="${documentEditorTitleRegionClassName(false, "preview")}"]`,
    );
    expect(region?.textContent).toBe("Launch plan");
    expect(region?.lastElementChild?.className).toContain(
      DOCUMENT_EDITOR_DATABASE_TITLE_SIZE_CLASS_NAME,
    );
    expect(
      placeholder.querySelector(
        `[class="${documentEditorBodyClassName("preview")}"]`,
      ),
    ).not.toBeNull();
    expect(placeholder.querySelector('[data-testid="properties"]')).not.toBe(
      null,
    );
  });

  it("keeps the row's Properties in the view's order and shape", () => {
    const rowView: DatabaseRowView = {
      type: "board",
      hiddenPropertyIds: ["a"],
    };
    draw(row({}), true, rowView);
    expect(drawn.properties).toMatchObject({
      documentId: "row-1",
      databaseId: "database",
      databaseDocumentId: "database-page",
      rowView,
      canEdit: true,
    });
  });

  it("expects the schema rows only from someone who edits the collection", () => {
    draw(row({}), true);
    expect(drawn.properties).toMatchObject({ schemaRowsExpected: true });
    draw(row({}), false);
    expect(drawn.properties).toMatchObject({ schemaRowsExpected: false });
    draw(row({ canEdit: false }), true);
    expect(drawn.properties).toMatchObject({ schemaRowsExpected: false });
  });

  it("holds the icon row the page will draw", () => {
    const iconRow = (document: Record<string, unknown>) =>
      draw(row(document)).querySelector(
        `[class="${documentEditorTitleRegionClassName(false, "preview")}"]`,
      )?.firstElementChild?.firstElementChild?.className;
    expect(iconRow({ icon: "A" })).toContain("size-14");
    expect(iconRow({ canEdit: true })).toBe("h-7");
    expect(iconRow({ canEdit: false })).toBeUndefined();
  });

  it("can't be used until the page takes over", () => {
    const placeholder = draw(row({}));
    expect(placeholder.hasAttribute("inert")).toBe(true);
    expect(placeholder.getAttribute("aria-busy")).toBe("true");
  });
});
