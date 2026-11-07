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
    dataUpdatedAt: 1,
    isError: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
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
  useDocumentProperties: () => ({
    data: mocks.response,
    isLoading: false,
    isError: mocks.isError,
    isPlaceholderData: false,
    fetchStatus: mocks.fetchStatus,
    dataUpdatedAt: mocks.dataUpdatedAt,
    refetch: mocks.refetch,
  }),
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
    schemaRowsExpected?: boolean;
    readFailureShownBelow?: boolean;
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
      schemaRowsExpected={options.schemaRowsExpected}
      readFailureShownBelow={options.readFailureShownBelow}
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
  mocks.dataUpdatedAt = 1;
  mocks.isError = false;
  mocks.fetchStatus = "idle";
  mocks.refetch.mockReset();
  mocks.response = {
    documentId: "row",
    databaseId: "database",
    canEditValues: true,
    canManageSchema: true,
    properties: ["a", "b", "c"].map((id) => property(id)),
  };
});

describe("a row's failed Properties read", () => {
  const shows = (text: string) => document.body.textContent?.includes(text);

  function failRead(response?: DocumentPropertiesResponse) {
    mocks.response = response as DocumentPropertiesResponse;
    mocks.dataUpdatedAt = 0;
    mocks.isError = true;
  }

  it("offers a retry instead of loading forever when there's nothing to show", async () => {
    failRead();
    renderProperties(null);

    expect(shows("editor.properties.loadingProperties")).toBe(false);
    expect(shows("empty.genericError")).toBe(true);
    const retry = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "database.retry",
    );
    await click(retry as HTMLButtonElement);
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("keeps loading while a retry is running", () => {
    failRead();
    mocks.fetchStatus = "fetching";
    renderProperties(null);

    expect(shows("editor.properties.loadingProperties")).toBe(true);
    expect(shows("empty.genericError")).toBe(false);
  });

  it("says so over a row's early copy when nothing else on screen does", () => {
    failRead(mocks.response);
    renderProperties(null);

    expect(rowIds()).toEqual([]);
    expect(shows("empty.genericError")).toBe(true);
  });

  it("keeps a row's early copy and stays quiet when the body reports it", () => {
    failRead(mocks.response);
    renderProperties(null, { readFailureShownBelow: true });

    expect(rowIds()).toEqual(["a", "b", "c"]);
    expect(shows("empty.genericError")).toBe(false);
  });

  it("shows nothing at all above a body that reports it", () => {
    failRead();
    renderProperties(null, { readFailureShownBelow: true });

    expect(shows("empty.genericError")).toBe(false);
    expect(shows("editor.properties.loadingProperties")).toBe(false);
  });
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

  it.each([
    { schemaRowsExpected: true, dataUpdatedAt: 0, drawn: true, usable: false },
    {
      schemaRowsExpected: true,
      dataUpdatedAt: 0,
      noAnswer: true,
      drawn: true,
      usable: false,
    },
    {
      schemaRowsExpected: false,
      dataUpdatedAt: 0,
      noAnswer: true,
      drawn: false,
    },
    { schemaRowsExpected: true, dataUpdatedAt: 1, drawn: false },
    { schemaRowsExpected: false, dataUpdatedAt: 0, drawn: false },
    { schemaRowsExpected: true, dataUpdatedAt: 0, isError: true, drawn: false },
    {
      schemaRowsExpected: true,
      dataUpdatedAt: 1,
      canManageSchema: true,
      canEdit: false,
      drawn: true,
      usable: false,
    },
    {
      schemaRowsExpected: true,
      dataUpdatedAt: 1,
      canManageSchema: true,
      drawn: true,
      usable: true,
    },
    {
      schemaRowsExpected: false,
      dataUpdatedAt: 1,
      canManageSchema: true,
      canEdit: false,
      drawn: false,
    },
  ])(
    "holds the Add property row, unusable until confirmed, only until the row's own read refuses it: %o",
    ({
      schemaRowsExpected,
      dataUpdatedAt,
      isError = false,
      canManageSchema = false,
      canEdit = true,
      noAnswer = false,
      drawn,
      usable,
    }) => {
      mocks.response = noAnswer
        ? (undefined as unknown as DocumentPropertiesResponse)
        : { ...mocks.response, canManageSchema };
      mocks.dataUpdatedAt = dataUpdatedAt;
      mocks.isError = isError;
      renderProperties(null, { schemaRowsExpected, canEdit });
      const addProperty = document.querySelector(
        '[aria-label="editor.properties.addProperty"]',
      );
      expect(!!addProperty).toBe(drawn);
      if (drawn) expect(!addProperty?.closest("[inert]")).toBe(usable);
    },
  );

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
