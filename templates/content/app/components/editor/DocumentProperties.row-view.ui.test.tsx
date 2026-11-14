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
    schemaRowsExpected?: boolean;
    leaveReadFailureToPage?: boolean;
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
      schemaRowsExpected={options.schemaRowsExpected}
      leaveReadFailureToPage={options.leaveReadFailureToPage}
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
  const shows = (text: string) => document.body.textContent.includes(text);

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
    renderProperties(null, { leaveReadFailureToPage: true });

    expect(rowIds()).toEqual(["a", "b", "c"]);
    expect(shows("empty.genericError")).toBe(false);
  });

  it("keeps a new Comment waiting under a Property in reach below the error", () => {
    failRead(mocks.response);
    const inline = {
      openPropertyId: null,
      toggle: vi.fn(),
      renderThreads: (propertyId: string) => (
        <p data-threads-for={propertyId}>threads</p>
      ),
    };
    renderProperties(null, { comments: { pendingPropertyId: "b", inline } });

    expect(shows("empty.genericError")).toBe(true);
    expect(rowIds()).toEqual([]);
    const waiting = document.querySelector("[data-property-waiting-comment]");
    expect(waiting?.textContent).toContain("b");
    expect(
      waiting?.querySelector(
        '[data-property-threads="b"] [data-threads-for="b"]',
      ),
    ).not.toBeNull();
  });

  it("leaves the error alone with no Comment waiting, or beside the page", () => {
    failRead(mocks.response);
    renderProperties(null, { comments: { pendingPropertyId: "b" } });
    expect(shows("empty.genericError")).toBe(true);
    expect(document.querySelector("[data-property-threads]")).toBeNull();
  });

  it("shows nothing at all above a body that reports it", () => {
    failRead();
    renderProperties(null, { leaveReadFailureToPage: true });

    expect(shows("empty.genericError")).toBe(false);
    expect(shows("editor.properties.loadingProperties")).toBe(false);
  });
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

  it("keeps open Always hide Properties in place when a view hides another Property", async () => {
    mocks.response.properties = [
      property("always", "value", "always_hide"),
      property("shown"),
      property("hidden-later"),
    ];
    const view = (hiddenPropertyIds: string[]): DatabaseRowView => ({
      type: "table",
      tableColumnOrderIds: ["shown", "hidden-later"],
      hiddenPropertyIds,
    });
    const { rerender } = renderProperties(view([]));
    await openLine(moreLine());
    expect(rowIds()).toEqual(["shown", "hidden-later", "always"]);
    const row = document.querySelector('[data-property-row="always"]');

    rerender(propertiesElement(view(["hidden-later"])));

    expect(rowIds()).toEqual(["shown", "hidden-later", "always"]);
    expect(alwaysHiddenLine()).toBeDefined();
    expect(document.querySelector('[data-property-row="always"]')).toBe(row);
  });

  it("keeps the other Always hide Properties open when one becomes Hide when empty", async () => {
    mocks.response.properties = [
      property("changed", "", "always_hide"),
      property("always", "value", "always_hide"),
    ];
    const { rerender } = renderProperties(null);
    await openLine(moreLine());
    expect(rowIds()).toEqual(["changed", "always"]);

    mocks.response = {
      ...mocks.response,
      properties: [
        property("changed", "", "hide_when_empty"),
        property("always", "value", "always_hide"),
      ],
    };
    rerender(propertiesElement(null));

    expect(rowIds()).toEqual(["changed", "always"]);
    expect(alwaysHiddenLine()).toBeDefined();
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

  it("lists a hidden Property for them while a Comment on it is written or open", () => {
    mocks.response.canManageSchema = false;
    mocks.response.properties = [
      property("always", "value", "always_hide"),
      property("empty", "", "hide_when_empty"),
      property("quiet", "", "hide_when_empty"),
      property("shown"),
    ];
    renderProperties(null, {
      comments: {
        pendingPropertyId: "always",
        inline: {
          openPropertyId: "empty",
          toggle: vi.fn(),
          renderThreads: () => null,
        },
      },
    });
    expect(rowIds()).toEqual(["shown", "always", "empty"]);
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

  it("opens a line closed by hand when Info asks back the Comment in it", async () => {
    const rowView: DatabaseRowView = {
      type: "board",
      hiddenPropertyIds: ["hidden"],
    };
    mocks.response.properties = [property("hidden"), property("shown")];
    const comments = (revealKey: number) => ({
      pendingPropertyId: "hidden",
      inline: {
        openPropertyId: null,
        revealKey,
        toggle: vi.fn(),
        renderThreads: () => null,
      },
    });
    const { rerender } = renderProperties(rowView, { comments: comments(0) });
    expect(rowIds()).toEqual(["shown", "hidden"]);

    await openLine(moreLine());
    expect(rowIds()).toEqual(["shown"]);

    rerender(propertiesElement(rowView, { comments: comments(1) }));
    expect(rowIds()).toEqual(["shown", "hidden"]);
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

  it("opens the line for a Property whose threads are open in Info", () => {
    renderProperties(
      { type: "board", hiddenPropertyIds: ["a"] },
      {
        comments: {
          inline: {
            openPropertyId: "a",
            toggle: vi.fn(),
            renderThreads: () => null,
          },
        },
      },
    );
    expect(rowIds()).toEqual(["b", "c", "a"]);
  });
});

describe("a Property's threads in Info", () => {
  const thread = { threadId: "thread" } as never;
  const inline = (openPropertyId: string | null) => ({
    openPropertyId,
    toggle: vi.fn(),
    renderThreads: (propertyId: string) => (
      <p data-threads-for={propertyId}>threads</p>
    ),
  });

  it("shows the open Property's threads right under its row", () => {
    renderProperties(null, {
      comments: {
        openThreadsByProperty: new Map([["b", [thread]]]),
        inline: inline("b"),
      },
    });
    const box = document.querySelector("[data-property-threads]");
    expect(box?.getAttribute("data-property-threads")).toBe("b");
    expect(box?.previousElementSibling?.getAttribute("data-property-row")).toBe(
      "b",
    );
    expect(box?.querySelector("[data-threads-for]")?.textContent).toBe(
      "threads",
    );
    expect(
      document
        .querySelector('[data-property-row="b"]')
        ?.classList.contains("comment-property-row--active"),
    ).toBe(true);
  });

  it("shows a new Comment there before the Property has threads", () => {
    renderProperties(null, {
      comments: { pendingPropertyId: "a", inline: inline("a") },
    });
    expect(
      document
        .querySelector("[data-property-threads]")
        ?.getAttribute("data-property-threads"),
    ).toBe("a");
  });

  it("keeps a new Comment under its row while another Property's threads open", () => {
    renderProperties(null, {
      comments: {
        openThreadsByProperty: new Map([["b", [thread]]]),
        pendingPropertyId: "a",
        inline: inline("b"),
      },
    });
    expect(
      [...document.querySelectorAll("[data-property-threads]")].map((box) =>
        box.getAttribute("data-property-threads"),
      ),
    ).toEqual(["a", "b"]);
  });

  it("shows a resolved thread Show opened there", () => {
    renderProperties(null, {
      comments: { selectedPropertyId: "a", inline: inline("a") },
    });
    expect(
      document
        .querySelector("[data-property-threads]")
        ?.getAttribute("data-property-threads"),
    ).toBe("a");
  });

  it("shows nothing under a row that has neither", () => {
    renderProperties(null, { comments: { inline: inline("a") } });
    expect(document.querySelector("[data-property-threads]")).toBeNull();
  });

  it("leaves a closed Property's threads out", () => {
    renderProperties(null, {
      comments: {
        openThreadsByProperty: new Map([["b", [thread]]]),
        inline: inline(null),
      },
    });
    expect(document.querySelector("[data-property-threads]")).toBeNull();
  });

  it("keeps the threads beside the page while Properties are on it", () => {
    renderProperties(null, {
      comments: { openThreadsByProperty: new Map([["b", [thread]]]) },
    });
    expect(document.querySelector("[data-property-threads]")).toBeNull();
  });
});
