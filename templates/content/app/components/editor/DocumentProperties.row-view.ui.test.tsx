// @vitest-environment happy-dom

import type { DocumentProperty, DocumentPropertiesResponse } from "@shared/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { click, renderUi } from "@/test-utils/render-ui";

import type { DatabaseRowView } from "./database/row-view-layout";
import {
  PropertyCommentsContext,
  type PropertyCommentsValue,
} from "./property-comments";

const mocks = vi.hoisted(() => {
  const mutation = () => ({
    mutateAsync: vi.fn(async (_input: unknown) => ({})),
    isPending: false,
  });
  return {
    response: undefined as unknown as DocumentPropertiesResponse,
    configure: mutation(),
    setValue: mutation(),
  };
});

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key}(${Object.values(options).join(", ")})` : key,
  useIconPickerLabels: () => ({}),
}));

vi.mock("@/hooks/use-document-properties", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-document-properties")>()),
  useSetDocumentProperty: () => mocks.setValue,
  useConfigureDocumentProperty: () => mocks.configure,
  useDuplicateDocumentProperty: () => mocks.configure,
  useDeleteDocumentProperty: () => mocks.configure,
  useDocumentProperties: () => ({ data: mocks.response, isLoading: false }),
}));

import { DocumentProperties } from "./DocumentProperties";

function property(
  id: string,
  value: DocumentProperty["value"] = "value",
  visibility: DocumentProperty["definition"]["visibility"] = "always_show",
): DocumentProperty {
  return {
    definition: {
      id,
      databaseId: "database",
      name: id,
      type: "text",
      visibility,
      options: {},
      position: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    value,
    editable: true,
  };
}

function rowIds(root: ParentNode = document) {
  return [...root.querySelectorAll("[data-property-row]")].map((row) =>
    row.getAttribute("data-property-row"),
  );
}

function hiddenInViewToggle() {
  return [...document.querySelectorAll("button")].find((button) =>
    button.textContent.includes("editor.properties.hiddenInThisView"),
  );
}

async function openHiddenInView() {
  const toggle = hiddenInViewToggle();
  if (!toggle) throw new Error("The hidden line isn't showing.");
  await click(toggle);
}

function renderProperties(
  rowView: DatabaseRowView | null,
  options: {
    rowViewPending?: boolean;
    canEdit?: boolean;
    comments?: Partial<PropertyCommentsValue>;
  } = {},
) {
  const properties = (
    <DocumentProperties
      documentId="row"
      databaseId="database"
      databaseDocumentId="database-page"
      rowView={rowView}
      rowViewPending={options.rowViewPending ?? false}
      canEdit={options.canEdit ?? true}
    />
  );
  return renderUi(
    options.comments ? (
      <PropertyCommentsContext.Provider
        value={{
          canComment: true,
          openThreadsByProperty: new Map(),
          pendingPropertyId: null,
          activeThreadId: null,
          selectedPropertyId: null,
          startComment: vi.fn(),
          openThread: vi.fn(),
          ...options.comments,
        }}
      >
        <TooltipProvider>{properties}</TooltipProvider>
      </PropertyCommentsContext.Provider>
    ) : (
      properties
    ),
  );
}

beforeEach(() => {
  mocks.response = {
    documentId: "row",
    databaseId: "database",
    canEditValues: true,
    canManageSchema: true,
    properties: ["a", "b", "c"].map((id) => property(id)),
  };
});

describe("a row's Properties in its view", () => {
  it("keeps the page's own order without a view, with no hidden line", () => {
    renderProperties(null);
    expect(rowIds()).toEqual(["a", "b", "c"]);
    expect(hiddenInViewToggle()).toBeUndefined();
  });

  it("follows the view and holds its hidden Properties behind a closed line", () => {
    renderProperties({
      type: "table",
      tableColumnOrderIds: ["c", "b", "a"],
      hiddenPropertyIds: ["b"],
    });
    expect(rowIds()).toEqual(["c", "a"]);
    expect(hiddenInViewToggle()?.textContent).toContain("1");
  });

  it("opens the hidden line in place without touching the collection", async () => {
    renderProperties({
      type: "board",
      propertyOrderIds: ["c"],
      hiddenPropertyIds: ["a", "b"],
    });
    expect(rowIds()).toEqual(["c"]);

    await openHiddenInView();

    expect(rowIds()).toEqual(["c", "a", "b"]);
    expect(mocks.configure.mutateAsync).not.toHaveBeenCalled();
  });

  it("shows the hidden line to someone who can only read the row", async () => {
    renderProperties(
      { type: "board", hiddenPropertyIds: ["a"] },
      { canEdit: false },
    );
    await openHiddenInView();
    expect(rowIds()).toEqual(["b", "c", "a"]);
  });

  it("lets Always hide and Hide when empty apply on top of the view", () => {
    mocks.response.properties = [
      property("always", "value", "always_hide"),
      property("empty", "", "hide_when_empty"),
      property("filled", "value", "hide_when_empty"),
      property("hidden-always", "value", "always_hide"),
      property("hidden-empty", "", "hide_when_empty"),
      property("hidden-filled", "value", "hide_when_empty"),
    ];
    renderProperties({
      type: "table",
      hiddenPropertyIds: ["hidden-always", "hidden-empty", "hidden-filled"],
    });
    expect(rowIds()).toEqual(["filled"]);
    expect(hiddenInViewToggle()?.textContent).toContain("1");
  });

  it("waits for the view instead of drawing the page's order first", () => {
    renderProperties(null, { rowViewPending: true });
    expect(rowIds()).toEqual([]);
    expect(document.body.textContent).toContain(
      "editor.properties.loadingProperties",
    );
  });

  it("opens the hidden line for a Comment being written on one of its Properties", () => {
    renderProperties(
      { type: "board", hiddenPropertyIds: ["a"] },
      { comments: { pendingPropertyId: "a" } },
    );
    expect(rowIds()).toEqual(["b", "c", "a"]);
  });

  it("opens the hidden line for a thread being read", () => {
    renderProperties(
      { type: "board", hiddenPropertyIds: ["a"] },
      { comments: { selectedPropertyId: "a" } },
    );
    expect(rowIds()).toEqual(["b", "c", "a"]);
  });

  it("stays closed for a thread that is only hovered", () => {
    renderProperties(
      { type: "board", hiddenPropertyIds: ["a"] },
      {
        comments: {
          openThreadsByProperty: new Map([
            ["a", [{ threadId: "thread" } as never]],
          ]),
          activeThreadId: "thread",
        },
      },
    );
    expect(rowIds()).toEqual(["b", "c"]);
  });
});
