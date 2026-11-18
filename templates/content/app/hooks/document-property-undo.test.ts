import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const callActionWithRetry = vi.hoisted(() => vi.fn());
const useQueryClient = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: { actionMessage?: string }) =>
    error.actionMessage,
  callActionWithRetry,
  useActionMutation,
  useActionQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual("@tanstack/react-query")),
  useQueryClient,
}));

vi.mock("sonner", () => ({ toast }));

import {
  documentPropertyUndo,
  documentPropertyUndoKey,
  groupDocumentPropertyChanges,
  sameDocumentPropertyValue,
} from "./document-property-undo";
import {
  applyDocumentPropertyValueToDatabaseResponse,
  contentDatabaseQueryKey,
} from "./use-content-database";
import { useSetDocumentProperty } from "./use-document-properties";

function turnProperty(value: string | null) {
  return {
    definition: {
      id: "turn",
      databaseId: "database-1",
      name: "Whose turn",
      type: "select",
      position: 0,
      options: {},
    },
    value,
  };
}

function savedResponse(value: string | null, documentId = "row-1") {
  return {
    documentId,
    databaseId: "database-1",
    canEditValues: true,
    canManageSchema: true,
    properties: [turnProperty(value)],
  };
}

type RowId = "row-1" | "row-2";

describe("Property undo", () => {
  let queryClient: QueryClient;
  let mutateAsync: Mock<
    (variables: {
      documentId: string;
      value: string | null;
    }) => Promise<ReturnType<typeof savedResponse>>
  >;
  let stored: string | null;
  let storedRow2: string | null;
  let setters: Record<RowId, ReturnType<typeof useSetDocumentProperty>>;

  function setTurn(
    value: string | null,
    request: object = {},
    documentId: RowId = "row-1",
  ) {
    return setters[documentId].mutateAsync({
      documentId,
      propertyId: "turn",
      value,
      ...request,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient();
    queryClient.setQueryData(contentDatabaseQueryKey("database-page-1"), {
      properties: [turnProperty(null)],
      items: [
        {
          id: "item-1",
          document: { id: "row-1" },
          properties: [turnProperty("alice")],
        },
        {
          id: "item-2",
          document: { id: "row-2" },
          properties: [turnProperty("alice")],
        },
      ],
    });
    stored = "alice";
    storedRow2 = "alice";
    useQueryClient.mockReturnValue(queryClient);
    mutateAsync = vi.fn(
      async (variables: { documentId: string; value: string | null }) => {
        if (variables.documentId === "row-2") storedRow2 = variables.value;
        else stored = variables.value;
        queryClient.setQueryData(
          contentDatabaseQueryKey("database-page-1"),
          (current: never) =>
            applyDocumentPropertyValueToDatabaseResponse(current, {
              documentId: variables.documentId,
              propertyId: "turn",
              value: variables.value,
            }),
        );
        return savedResponse(variables.value, variables.documentId);
      },
    );
    useActionMutation.mockReturnValue({ mutateAsync, mutate: vi.fn() });
    setters = {
      "row-1": useSetDocumentProperty("row-1", "database-1", "database-page-1"),
      "row-2": useSetDocumentProperty("row-2", "database-1", "database-page-1"),
    };
    callActionWithRetry.mockImplementation(
      async (_name, params: { documentId: string }) =>
        params.documentId === "row-2"
          ? savedResponse(storedRow2, "row-2")
          : savedResponse(stored),
    );
  });

  it("puts a row's Property back after it has left the view, and redoes it", async () => {
    await setTurn("agent");
    queryClient.removeQueries({
      queryKey: contentDatabaseQueryKey("database-page-1"),
    });

    const controller = documentPropertyUndo(queryClient);
    expect(controller.canUndo()).toBe(true);
    await expect(controller.undo()).resolves.toBe(true);
    expect(callActionWithRetry).toHaveBeenCalledWith(
      "list-document-properties",
      { documentId: "row-1", databaseId: "database-1" },
    );
    expect(mutateAsync).toHaveBeenLastCalledWith(
      {
        documentId: "row-1",
        propertyId: "turn",
        value: "alice",
        databaseId: "database-1",
      },
      undefined,
    );
    expect(controller.canUndo()).toBe(false);

    await expect(controller.redo()).resolves.toBe(true);
    expect(stored).toBe("agent");
    expect(controller.canUndo()).toBe(true);
    expect(mutateAsync).toHaveBeenCalledTimes(3);
  });

  it("leaves a value someone changed since the edit, and drops the step", async () => {
    await setTurn("agent");
    stored = "bot";

    const controller = documentPropertyUndo(queryClient);
    await expect(controller.undo()).resolves.toBe(false);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      "Not undone: this property changed after your edit",
    );
    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(false);
  });

  it("keeps the step when the undo's save fails, so it can be tried again", async () => {
    await setTurn("agent");
    mutateAsync.mockRejectedValueOnce(new Error("offline"));

    const controller = documentPropertyUndo(queryClient);
    await expect(controller.undo()).resolves.toBe(false);
    expect(controller.canUndo()).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("undoes quick picks in one menu as one step", async () => {
    await setTurn("agent");
    await setTurn("bot");

    const controller = documentPropertyUndo(queryClient);
    await controller.undo();
    expect(stored).toBe("alice");
    expect(controller.canUndo()).toBe(false);
  });

  it("undoes an edit across selected rows as one step, and finishes one cut short", async () => {
    await setTurn("bot");
    await groupDocumentPropertyChanges(queryClient, async () => {
      await setTurn("agent", {}, "row-1");
      await setTurn("agent", {}, "row-2");
    });

    const controller = documentPropertyUndo(queryClient);
    mutateAsync.mockImplementationOnce(async (variables) => {
      stored = variables.value;
      return savedResponse(variables.value);
    });
    mutateAsync.mockRejectedValueOnce(new Error("offline"));
    await expect(controller.undo()).resolves.toBe(false);
    expect([stored, storedRow2]).toEqual(["bot", "agent"]);

    await expect(controller.undo()).resolves.toBe(true);
    expect([stored, storedRow2]).toEqual(["bot", "alice"]);
    await controller.undo();
    expect(stored).toBe("alice");
  });

  it("records neither a save that changes nothing nor a Blocks field", async () => {
    await setTurn("alice");
    await setTurn("agent", { expectedBlocksFieldRevision: 3 });
    expect(documentPropertyUndo(queryClient).canUndo()).toBe(false);
  });

  it("records nothing for a row no loaded read shows", async () => {
    queryClient.clear();
    await setTurn("agent");
    expect(documentPropertyUndo(queryClient).canUndo()).toBe(false);
  });
});

describe("documentPropertyUndoKey", () => {
  const button = { tagName: "BUTTON", isContentEditable: false };
  const press = (
    key: string,
    modifiers: object = {},
    target: object = button,
  ) =>
    documentPropertyUndoKey({
      key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      target: target as EventTarget,
      ...modifiers,
    });

  it("reads ⌘Z, ⌘⇧Z, Ctrl+Z and Ctrl+Y", () => {
    expect(press("z", { metaKey: true })).toBe("undo");
    expect(press("Z", { metaKey: true, shiftKey: true })).toBe("redo");
    expect(press("z", { ctrlKey: true })).toBe("undo");
    expect(press("y", { ctrlKey: true })).toBe("redo");
  });

  it("leaves text fields, the page editor and other keys alone", () => {
    expect(press("z", { metaKey: true }, { tagName: "INPUT" })).toBeNull();
    expect(press("z", { metaKey: true }, { tagName: "TEXTAREA" })).toBeNull();
    expect(
      press(
        "z",
        { metaKey: true },
        { tagName: "DIV", isContentEditable: true },
      ),
    ).toBeNull();
    expect(press("z")).toBeNull();
    expect(press("z", { metaKey: true, altKey: true })).toBeNull();
    expect(press("c", { metaKey: true })).toBeNull();
  });
});

describe("sameDocumentPropertyValue", () => {
  it("compares values by content, not key order", () => {
    expect(
      sameDocumentPropertyValue(
        { start: "2026-11-18", includeTime: false },
        { includeTime: false, start: "2026-11-18" },
      ),
    ).toBe(true);
    expect(sameDocumentPropertyValue(null, undefined)).toBe(true);
    expect(sameDocumentPropertyValue(["a", "b"], ["b", "a"])).toBe(false);
  });
});
