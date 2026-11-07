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

function lineFor(key: string) {
  return [...document.querySelectorAll("button")].find((button) =>
    button.textContent.includes(key),
  );
}

function moreLine() {
  return lineFor("editor.properties.moreProperties");
}

function alwaysHiddenLine() {
  return lineFor("editor.properties.alwaysHiddenCount");
}

async function openLine(line: HTMLButtonElement | undefined) {
  if (!line) throw new Error("The line isn't showing.");
  await click(line);
}

function propertiesElement(
  rowView: DatabaseRowView | null,
  options: {
    documentId?: string;
    rowViewPending?: boolean;
    canEdit?: boolean;
    comments?: Partial<PropertyCommentsValue>;
  } = {},
) {
  const properties = (
    <DocumentProperties
      documentId={options.documentId ?? "row"}
      databaseId="database"
      databaseDocumentId="database-page"
      rowView={rowView}
      rowViewPending={options.rowViewPending ?? false}
      canEdit={options.canEdit ?? true}
    />
  );
  return options.comments ? (
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
  );
}

function renderProperties(
  rowView: DatabaseRowView | null,
  options: Parameters<typeof propertiesElement>[1] = {},
) {
  return renderUi(propertiesElement(rowView, options));
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
  it("keeps the page's own order without a view, with no line", () => {
    renderProperties(null);
    expect(rowIds()).toEqual(["a", "b", "c"]);
    expect(moreLine()).toBeUndefined();
  });

  it("follows the view and holds its hidden Properties behind a closed line", () => {
    renderProperties({
      type: "table",
      tableColumnOrderIds: ["c", "b", "a"],
      hiddenPropertyIds: ["b"],
    });
    expect(rowIds()).toEqual(["c", "a"]);
    expect(moreLine()?.textContent).toContain(
      "editor.properties.morePropertiesOne",
    );
  });

  it("opens the line in place without touching the collection", async () => {
    renderProperties({
      type: "board",
      propertyOrderIds: ["c"],
      hiddenPropertyIds: ["a", "b"],
    });
    expect(rowIds()).toEqual(["c"]);
    expect(moreLine()?.textContent).toContain(
      "editor.properties.moreProperties(2)",
    );

    await openLine(moreLine());

    expect(rowIds()).toEqual(["c", "a", "b"]);
    expect(mocks.configure.mutateAsync).not.toHaveBeenCalled();
  });

  it("shows the line to someone who can only read the row", async () => {
    renderProperties(
      { type: "board", hiddenPropertyIds: ["a"] },
      { canEdit: false },
    );
    await openLine(moreLine());
    expect(rowIds()).toEqual(["b", "c", "a"]);
  });

  it("keeps Always hide and empty Properties from someone who can only read", async () => {
    mocks.response.properties = [
      property("always", "value", "always_hide"),
      property("empty", "", "hide_when_empty"),
      property("filled", "value", "hide_when_empty"),
      property("hidden", "value"),
    ];
    renderProperties(
      { type: "table", hiddenPropertyIds: ["hidden"] },
      { canEdit: false },
    );
    expect(moreLine()?.textContent).toContain(
      "editor.properties.morePropertiesOne",
    );

    await openLine(moreLine());

    expect(rowIds()).toEqual(["filled", "hidden"]);
    expect(alwaysHiddenLine()).toBeUndefined();
  });

  it("holds view-hidden, empty and Always hide Properties behind one line", async () => {
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
    expect(moreLine()?.textContent).toContain(
      "editor.properties.moreProperties(5)",
    );

    await openLine(moreLine());

    expect(rowIds()).toEqual([
      "filled",
      "hidden-filled",
      "empty",
      "hidden-empty",
    ]);
    expect(alwaysHiddenLine()?.textContent).toContain(
      "editor.properties.alwaysHiddenCount(2)",
    );

    await openLine(alwaysHiddenLine());

    expect(rowIds()).toEqual([
      "filled",
      "hidden-filled",
      "empty",
      "hidden-empty",
      "always",
      "hidden-always",
    ]);
    expect(mocks.configure.mutateAsync).not.toHaveBeenCalled();
  });

  it("needs no second line when Always hide Properties are all there is", async () => {
    mocks.response.properties = [
      property("always", "value", "always_hide"),
      property("other-always", "value", "always_hide"),
      property("shown"),
    ];
    renderProperties(null);
    expect(rowIds()).toEqual(["shown"]);

    await openLine(moreLine());

    expect(rowIds()).toEqual(["shown", "always", "other-always"]);
    expect(alwaysHiddenLine()).toBeUndefined();
  });

  it("leaves a Hide when empty Property where it is until the row reopens", async () => {
    mocks.response.properties = [
      property("was-empty", "", "hide_when_empty"),
      property("was-filled", "value", "hide_when_empty"),
    ];
    const { rerender } = renderProperties(null);
    await openLine(moreLine());
    expect(rowIds()).toEqual(["was-filled", "was-empty"]);

    mocks.response = {
      ...mocks.response,
      properties: [
        property("was-empty", "value", "hide_when_empty"),
        property("was-filled", "", "hide_when_empty"),
      ],
    };
    rerender(propertiesElement(null));
    expect(rowIds()).toEqual(["was-filled", "was-empty"]);

    const reopened = mocks.response;
    mocks.response = { ...reopened, documentId: "other-row" };
    rerender(propertiesElement(null, { documentId: "other-row" }));
    mocks.response = reopened;
    rerender(propertiesElement(null));
    expect(rowIds()).toEqual(["was-empty"]);
  });

  it("leaves a filled Property where it is when another one becomes Hide when empty", async () => {
    mocks.response.properties = [
      property("was-empty", "", "hide_when_empty"),
      property("joins", "value"),
    ];
    const { rerender } = renderProperties(null);
    await openLine(moreLine());
    expect(rowIds()).toEqual(["joins", "was-empty"]);

    mocks.response = {
      ...mocks.response,
      properties: [
        property("was-empty", "value", "hide_when_empty"),
        property("joins", "value", "hide_when_empty"),
      ],
    };
    rerender(propertiesElement(null));
    expect(rowIds()).toEqual(["joins", "was-empty"]);

    mocks.response = {
      ...mocks.response,
      properties: [...mocks.response.properties].reverse(),
    };
    rerender(propertiesElement(null));
    expect(rowIds()).toEqual(["joins", "was-empty"]);
  });

  it("keeps Always hide and empty Properties from someone who can edit values but not the schema", async () => {
    mocks.response.canManageSchema = false;
    mocks.response.properties = [
      property("always", "value", "always_hide"),
      property("empty", "", "hide_when_empty"),
      property("hidden"),
      property("shown"),
    ];
    renderProperties({ type: "table", hiddenPropertyIds: ["hidden"] });
    await openLine(moreLine());
    expect(rowIds()).toEqual(["shown", "hidden"]);
    expect(alwaysHiddenLine()).toBeUndefined();
  });

  it("waits for the view instead of drawing the page's order first", () => {
    mocks.response.properties = [property("always", "value", "always_hide")];
    renderProperties(null, { rowViewPending: true });
    expect(rowIds()).toEqual([]);
    expect(moreLine()).toBeUndefined();
    expect(document.body.textContent).toContain(
      "editor.properties.loadingProperties",
    );
  });

  it("opens the line for a Comment being written on one of its Properties", () => {
    renderProperties(
      { type: "board", hiddenPropertyIds: ["a"] },
      { comments: { pendingPropertyId: "a" } },
    );
    expect(rowIds()).toEqual(["b", "c", "a"]);
  });

  it("opens the line for a thread being read", () => {
    renderProperties(
      { type: "board", hiddenPropertyIds: ["a"] },
      { comments: { selectedPropertyId: "a" } },
    );
    expect(rowIds()).toEqual(["b", "c", "a"]);
  });

  it("opens both lines for a Comment on an Always hide Property", () => {
    mocks.response.properties = [
      property("always", "value", "always_hide"),
      property("empty", "", "hide_when_empty"),
      property("shown"),
    ];
    renderProperties(null, { comments: { selectedPropertyId: "always" } });
    expect(rowIds()).toEqual(["shown", "empty", "always"]);
  });

  it("opens a line closed by hand when a different thread is read", async () => {
    const rowView: DatabaseRowView = {
      type: "board",
      hiddenPropertyIds: ["hidden"],
    };
    mocks.response.properties = [
      property("always", "value", "always_hide"),
      property("hidden"),
      property("shown"),
    ];
    const { rerender } = renderProperties(rowView, {
      comments: { selectedPropertyId: "hidden" },
    });
    expect(rowIds()).toEqual(["shown", "hidden"]);

    await openLine(moreLine());
    expect(rowIds()).toEqual(["shown"]);

    rerender(
      propertiesElement(rowView, {
        comments: { selectedPropertyId: "always" },
      }),
    );
    expect(rowIds()).toEqual(["shown", "hidden", "always"]);
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
