// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: null as Record<string, unknown> | null,
  editorProps: null as Record<string, unknown> | null,
  save: vi.fn(async () => ({})),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/hooks/use-document-properties", () => ({
  documentPropertiesResponseMatchesScope: (
    documentId: string,
    databaseId: string | null,
    data: { documentId?: string; databaseId?: string | null } | undefined,
  ) => data?.documentId === documentId && data?.databaseId === databaseId,
  useDocumentProperties: () => mocks.query,
  useReorderDocumentProperty: () => ({ mutateAsync: vi.fn() }),
  useSetDocumentProperty: () => ({ mutateAsync: mocks.save }),
}));
vi.mock("@/components/QueryErrorState", () => ({
  QueryErrorState: () => createElement("div", { "data-query-error": "" }),
}));
vi.mock("./VisualEditor", () => ({
  VisualEditor: (props: Record<string, unknown>) => {
    mocks.editorProps = props;
    return createElement("div", { "data-editable": String(props.editable) });
  },
}));

import {
  __resetBlockFieldSaveRegistry,
  flushAllBlockFieldSaveControllersForDocument,
} from "./blockFieldSaveRegistry";
import { DocumentBlockFields } from "./DocumentBlockFields";

function field(id: string, primary: boolean) {
  return {
    definition: {
      id,
      databaseId: "db-1",
      name: id,
      type: "blocks",
      visibility: "always_show",
      options: { blocks: { primary } },
      position: 0,
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:00:00.000Z",
    },
    value: "Original",
    editable: true,
  };
}

describe("DocumentBlockFields suggestion boundary", () => {
  let root: Root;
  let container: HTMLDivElement;
  const availability = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.query = { data: undefined, isError: false, isRefetching: false };
    mocks.editorProps = null;
    mocks.save.mockReset();
    mocks.save.mockImplementation(async () => ({}));
    availability.mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    __resetBlockFieldSaveRegistry();
    vi.unstubAllGlobals();
  });

  async function render(suggesting = false, enteringSuggestion = false) {
    await act(async () => {
      root.render(
        createElement(DocumentBlockFields, {
          documentId: "doc-1",
          databaseId: "db-1",
          databaseDocumentId: "row-1",
          canEdit: true,
          suggesting,
          enteringSuggestion,
          primaryEditor: createElement("div", { "data-primary-editor": "" }),
          onPrimaryFieldAvailabilityChange: availability,
        }),
      );
    });
  }

  it("reports primary availability only for a loaded field in the current row", async () => {
    await render();
    expect(availability).toHaveBeenLastCalledWith("doc-1:db-1:row-1", false);

    mocks.query = {
      data: {
        documentId: "old-doc",
        databaseId: "db-1",
        properties: [field("content", true)],
      },
      isError: false,
    };
    await render();
    expect(container.querySelector("[data-primary-editor]")).toBeNull();
    expect(availability).toHaveBeenLastCalledWith("doc-1:db-1:row-1", false);

    mocks.query = {
      data: {
        documentId: "doc-1",
        databaseId: "db-1",
        properties: [field("content", true)],
      },
      isError: false,
    };
    await render();
    expect(container.querySelector("[data-primary-editor]")).not.toBeNull();
    expect(availability).toHaveBeenLastCalledWith("doc-1:db-1:row-1", true);

    mocks.query = { ...mocks.query, isError: true };
    await render(true);
    expect(container.querySelector("[data-query-error]")).not.toBeNull();
    expect(availability).toHaveBeenLastCalledWith("doc-1:db-1:row-1", false);

    mocks.query = { data: undefined, isError: false, isFetching: true };
    await render(true);
    expect(
      container.querySelector("[data-block-fields-state=loading]"),
    ).not.toBeNull();
    expect(availability).toHaveBeenLastCalledWith("doc-1:db-1:row-1", false);
  });

  it("makes a secondary editor read-only during suggesting and restores editing afterward", async () => {
    mocks.query = {
      data: {
        documentId: "doc-1",
        databaseId: "db-1",
        canEditValues: true,
        properties: [field("outline", false)],
      },
      isError: false,
    };
    await render();
    expect(
      container.querySelector("[data-editable]")?.getAttribute("data-editable"),
    ).toBe("true");

    await render(true);
    expect(
      container.querySelector("[data-editable]")?.getAttribute("data-editable"),
    ).toBe("false");
    const save = mocks.editorProps?.onSaveContent as (
      value: string,
    ) => Promise<string>;
    await expect(save("Attempted direct write")).resolves.toBe("failed");
    expect(mocks.save).not.toHaveBeenCalled();

    await render(false);
    expect(
      container.querySelector("[data-editable]")?.getAttribute("data-editable"),
    ).toBe("true");
  });

  it("locks input while a pre-entry save is in flight and finishes that draft", async () => {
    let finishSave!: () => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = () => resolve({});
        }),
    );
    mocks.query = {
      data: {
        documentId: "doc-1",
        databaseId: "db-1",
        canEditValues: true,
        properties: [field("outline", false)],
      },
      isError: false,
    };
    await render();
    await act(async () => {
      (mocks.editorProps?.onChange as (value: string) => void)(
        "Pre-entry draft",
      );
    });

    await render(true, true);
    expect(
      container.querySelector("[data-editable]")?.getAttribute("data-editable"),
    ).toBe("false");
    const flushing = flushAllBlockFieldSaveControllersForDocument("doc-1");
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ value: "Pre-entry draft" }),
    );

    const save = mocks.editorProps?.onSaveContent as (
      value: string,
    ) => Promise<string>;
    await expect(save("New edit after lock")).resolves.toBe("failed");
    const queuedSave = save("Pre-entry draft");
    expect(mocks.save).toHaveBeenCalledTimes(1);
    finishSave();
    await flushing;
    await expect(queuedSave).resolves.toBe("persisted");

    await render(true, false);
    await expect(
      (mocks.editorProps?.onSaveContent as (value: string) => Promise<string>)(
        "Pre-entry draft",
      ),
    ).resolves.toBe("failed");
  });
});
