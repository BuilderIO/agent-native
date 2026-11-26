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
  leaveDocumentPropertyUndoPage,
  sameDocumentPropertyValue,
  startDocumentPropertySave,
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

interface SaveRequest {
  documentId: string;
  propertyId: string;
  value: string | null;
  databaseId: string;
  expectedGeneration?: number;
}

const bothRows = [
  { documentId: "row-1", propertyId: "turn" },
  { documentId: "row-2", propertyId: "turn" },
];

const generationConflict = () =>
  Object.assign(new Error("The property changed"), {
    errorCode: "PROPERTY_GENERATION_CONFLICT",
  });

describe("Property undo", () => {
  let queryClient: QueryClient;
  let mutateAsync: Mock<
    (
      variables: SaveRequest,
    ) => Promise<ReturnType<typeof savedResponse> & { generation: number }>
  >;
  let stored: string | null;
  let storedRow2: string | null;
  let generations: Record<RowId, number>;
  let offline: Set<string>;
  let setters: Record<RowId, ReturnType<typeof useSetDocumentProperty>>;

  async function serverSave(variables: SaveRequest) {
    const row: RowId = variables.documentId === "row-2" ? "row-2" : "row-1";
    if (offline.delete(row)) throw new Error("offline");
    if (
      variables.expectedGeneration !== undefined &&
      variables.expectedGeneration !== generations[row]
    ) {
      throw generationConflict();
    }
    generations[row] += 1;
    if (row === "row-2") storedRow2 = variables.value;
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
    return {
      ...savedResponse(variables.value, variables.documentId),
      generation: generations[row],
    };
  }

  function changeElsewhere(value: string | null) {
    stored = value;
    generations["row-1"] += 1;
  }

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
    generations = { "row-1": 0, "row-2": 0 };
    offline = new Set();
    useQueryClient.mockReturnValue(queryClient);
    mutateAsync = vi.fn(serverSave);
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
        expectedGeneration: 1,
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
    changeElsewhere("bot");

    const controller = documentPropertyUndo(queryClient);
    await expect(controller.undo()).resolves.toBe(false);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      "Not undone: this property changed after your edit",
    );
    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(false);
  });

  it("leaves a value changed between the undo's check and its save", async () => {
    await setTurn("agent");
    callActionWithRetry.mockImplementationOnce(async () => {
      const read = savedResponse(stored);
      changeElsewhere("bot");
      return read;
    });

    const controller = documentPropertyUndo(queryClient);
    await expect(controller.undo()).resolves.toBe(false);
    expect(stored).toBe("bot");
    expect(toast).toHaveBeenCalledWith(
      "Not undone: this property changed after your edit",
    );
    expect(controller.canUndo()).toBe(false);
  });

  it("keeps the step when the undo's save fails, so it can be tried again", async () => {
    await setTurn("agent");
    offline.add("row-1");

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
    await groupDocumentPropertyChanges(queryClient, bothRows, async () => {
      await setTurn("agent", {}, "row-1");
      await setTurn("agent", {}, "row-2");
    });

    const controller = documentPropertyUndo(queryClient);
    offline.add("row-2");
    await expect(controller.undo()).resolves.toBe(false);
    expect([stored, storedRow2]).toEqual(["bot", "agent"]);

    await expect(controller.undo()).resolves.toBe(true);
    expect([stored, storedRow2]).toEqual(["bot", "alice"]);
    await controller.undo();
    expect(stored).toBe("alice");
  });

  it("puts back rows already undone when a later row's save conflicts", async () => {
    await groupDocumentPropertyChanges(queryClient, bothRows, async () => {
      await setTurn("agent", {}, "row-1");
      await setTurn("agent", {}, "row-2");
    });
    callActionWithRetry.mockImplementation(
      async (_name, params: { documentId: string }) => {
        if (params.documentId === "row-1") return savedResponse(stored);
        generations["row-2"] += 1;
        return savedResponse(storedRow2, "row-2");
      },
    );

    const controller = documentPropertyUndo(queryClient);
    await expect(controller.undo()).resolves.toBe(false);
    expect([stored, storedRow2]).toEqual(["agent", "agent"]);
    expect(toast).toHaveBeenCalledWith(
      "Not undone: this property changed after your edit",
    );
    expect(controller.canUndo()).toBe(false);
  });

  it("keeps the step when a row it put back can't be restored after a conflict, and restores it on the next try", async () => {
    await groupDocumentPropertyChanges(queryClient, bothRows, async () => {
      await setTurn("agent", {}, "row-1");
      await setTurn("agent", {}, "row-2");
    });
    callActionWithRetry.mockImplementation(
      async (_name, params: { documentId: string }) => {
        if (params.documentId === "row-1") return savedResponse(stored);
        generations["row-2"] += 1;
        return savedResponse(storedRow2, "row-2");
      },
    );
    mutateAsync.mockImplementation(async (variables) => {
      const saved = await serverSave(variables);
      if (variables.documentId === "row-1") offline.add("row-1");
      return saved;
    });

    const controller = documentPropertyUndo(queryClient);
    await expect(controller.undo()).resolves.toBe(false);
    expect([stored, storedRow2]).toEqual(["alice", "agent"]);
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't undo the property change",
      { description: "offline" },
    );
    expect(controller.canUndo()).toBe(true);

    await expect(controller.undo()).resolves.toBe(false);
    expect([stored, storedRow2]).toEqual(["agent", "agent"]);
    expect(toast).toHaveBeenCalledWith(
      "Not undone: this property changed after your edit",
    );
    expect(controller.canUndo()).toBe(false);
  });

  it("puts back a row whose undo may have saved when the next try conflicts", async () => {
    await groupDocumentPropertyChanges(queryClient, bothRows, async () => {
      await setTurn("agent", {}, "row-1");
      await setTurn("agent", {}, "row-2");
    });
    const lostReplies = new Set<string>(["row-1"]);
    mutateAsync.mockImplementation(async (variables) => {
      const saved = await serverSave(variables);
      if (lostReplies.delete(variables.documentId)) throw new Error("offline");
      return saved;
    });

    const controller = documentPropertyUndo(queryClient);
    await expect(controller.undo()).resolves.toBe(false);
    expect([stored, storedRow2]).toEqual(["alice", "agent"]);

    storedRow2 = "bot";
    generations["row-2"] += 1;
    await expect(controller.undo()).resolves.toBe(false);
    expect([stored, storedRow2]).toEqual(["agent", "bot"]);
    expect(toast).toHaveBeenCalledWith(
      "Not undone: this property changed after your edit",
    );
    expect(controller.canUndo()).toBe(false);
  });

  it("undoes the rows that saved when an edit across rows partly fails", async () => {
    offline.add("row-2");
    await groupDocumentPropertyChanges(queryClient, bothRows, async () => {
      await setTurn("agent", {}, "row-1");
      await setTurn("agent", {}, "row-2").catch(() => undefined);
    });

    const controller = documentPropertyUndo(queryClient);
    await controller.undo();
    expect([stored, storedRow2]).toEqual(["alice", "alice"]);
    expect(controller.canUndo()).toBe(false);
  });

  it("records nothing from two edits across the same rows at once", async () => {
    let releaseFirst = () => {};
    const first = groupDocumentPropertyChanges(
      queryClient,
      bothRows,
      async () => {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        await setTurn("agent", {}, "row-1");
      },
    );
    await groupDocumentPropertyChanges(queryClient, bothRows, async () => {
      await setTurn("bot", {}, "row-2");
    });
    releaseFirst();
    await first;

    expect(documentPropertyUndo(queryClient).canUndo()).toBe(false);
  });

  it("drops an edit across rows that gets a second save to one of its rows", async () => {
    await groupDocumentPropertyChanges(queryClient, bothRows, async () => {
      await setTurn("agent", {}, "row-1");
      await setTurn("bot", {}, "row-1");
      await setTurn("agent", {}, "row-2");
    });

    expect(documentPropertyUndo(queryClient).canUndo()).toBe(false);
  });

  it("records nothing from a save made while a bulk edit of that Property is on its way", async () => {
    const bulk = startDocumentPropertySave(
      queryClient,
      { documentId: "row-1", propertyId: "turn" },
      { optimistic: false },
    );
    await setTurn("agent");
    bulk.settled();

    expect(documentPropertyUndo(queryClient).canUndo()).toBe(false);
  });

  it("trusts no bulk edit made while another save to that Property is on its way", () => {
    const target = { documentId: "row-1", propertyId: "turn" };
    const save = startDocumentPropertySave(queryClient, target);
    const bulk = startDocumentPropertySave(queryClient, target, {
      optimistic: false,
    });
    expect(bulk.trusted()).toBe(false);
    bulk.settled();
    save.settled();

    const alone = startDocumentPropertySave(queryClient, target, {
      optimistic: false,
    });
    expect(alone.trusted()).toBe(true);
    alone.settled();
  });

  it("keeps an edit across rows whole when another one closes first", async () => {
    let releaseFirst = () => {};
    let releaseSecond = () => {};
    const first = groupDocumentPropertyChanges(
      queryClient,
      [{ documentId: "row-1", propertyId: "other" }],
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const second = groupDocumentPropertyChanges(
      queryClient,
      bothRows,
      async () => {
        await new Promise<void>((resolve) => {
          releaseSecond = resolve;
        });
        await setTurn("agent", {}, "row-1");
        await setTurn("agent", {}, "row-2");
      },
    );
    releaseFirst();
    await first;
    releaseSecond();
    await second;

    const controller = documentPropertyUndo(queryClient);
    await controller.undo();
    expect([stored, storedRow2]).toEqual(["alice", "alice"]);
    expect(controller.canUndo()).toBe(false);
  });

  it("keeps a save on another row out of an open edit across rows", async () => {
    await groupDocumentPropertyChanges(
      queryClient,
      [{ documentId: "row-1", propertyId: "turn" }],
      async () => {
        await setTurn("agent", {}, "row-1");
        await setTurn("bot", {}, "row-2");
      },
    );

    const controller = documentPropertyUndo(queryClient);
    await controller.undo();
    expect([stored, storedRow2]).toEqual(["alice", "bot"]);
    await controller.undo();
    expect(storedRow2).toBe("alice");
  });

  it("says so when the undo can't read the row, and keeps the step", async () => {
    await setTurn("agent");
    callActionWithRetry.mockRejectedValueOnce(new Error("offline"));

    const controller = documentPropertyUndo(queryClient);
    await expect(controller.undo()).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't undo the property change",
      { description: "offline" },
    );
    expect(controller.canUndo()).toBe(true);
    await expect(controller.undo()).resolves.toBe(true);
    expect(stored).toBe("alice");
  });

  it("records nothing from a save made while an earlier one to the same Property failed", async () => {
    let failFirst = () => {};
    mutateAsync.mockImplementationOnce((variables) => {
      queryClient.setQueryData(
        contentDatabaseQueryKey("database-page-1"),
        (current: never) =>
          applyDocumentPropertyValueToDatabaseResponse(current, {
            documentId: "row-1",
            propertyId: "turn",
            value: variables.value,
          }),
      );
      return new Promise((_resolve, reject) => {
        failFirst = () => reject(new Error("offline"));
      });
    });
    const first = setTurn("agent");
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const second = setTurn("bot");
    failFirst();
    await expect(first).rejects.toThrow("offline");
    await second;

    expect(stored).toBe("bot");
    expect(documentPropertyUndo(queryClient).canUndo()).toBe(false);
  });

  it("leaves a save that lands after the page changed off the new page's list", async () => {
    let land = () => {};
    mutateAsync.mockImplementationOnce(async (variables) => {
      await new Promise<void>((resolve) => {
        land = resolve;
      });
      return serverSave(variables);
    });
    const saving = setTurn("agent");
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    leaveDocumentPropertyUndoPage(queryClient);
    land();
    await saving;

    expect(stored).toBe("agent");
    expect(documentPropertyUndo(queryClient).canUndo()).toBe(false);
  });

  it("keeps the new page's list when a save from the old page fails", async () => {
    let failFirst = () => {};
    mutateAsync.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failFirst = () => reject(new Error("offline"));
        }),
    );
    const first = setTurn("agent");
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    await setTurn("bot");
    leaveDocumentPropertyUndoPage(queryClient);
    await setTurn("agent", {}, "row-2");
    failFirst();
    await expect(first).rejects.toThrow("offline");

    const controller = documentPropertyUndo(queryClient);
    await controller.undo();
    expect(storedRow2).toBe("alice");
  });

  it("records neither a save that changes nothing nor a Blocks field", async () => {
    await setTurn("alice");
    await setTurn("agent", { expectedBlocksFieldRevision: 3 });
    expect(documentPropertyUndo(queryClient).canUndo()).toBe(false);
  });

  it("records nothing for a row no loaded read shows, and forgets older edits", async () => {
    await setTurn("agent");
    queryClient.clear();
    await setTurn("bot");
    expect(documentPropertyUndo(queryClient).canUndo()).toBe(false);
  });

  it("drops an edit across rows when one row can't be recorded", async () => {
    await setTurn("bot");
    await groupDocumentPropertyChanges(queryClient, bothRows, async () => {
      await setTurn("agent", {}, "row-2");
      queryClient.clear();
      await setTurn("agent", {}, "row-1");
    });
    expect(documentPropertyUndo(queryClient).canUndo()).toBe(false);
  });

  it("forgets the list when a Property is saved while an undo runs", async () => {
    await setTurn("agent");
    let release = () => {};
    callActionWithRetry.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return savedResponse(stored);
    });

    const controller = documentPropertyUndo(queryClient);
    const undoing = controller.undo();
    await setTurn("agent", {}, "row-2");
    release();
    await undoing;
    expect(stored).toBe("alice");
    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(false);
  });

  it("leaves a guarded save's conflict for the undo to report", () => {
    const [, options] = useActionMutation.mock.calls[0] as [
      string,
      {
        onError: (
          error: unknown,
          variables: SaveRequest,
          context: unknown,
        ) => void;
      },
    ];
    const request: SaveRequest = {
      documentId: "row-1",
      propertyId: "turn",
      value: "alice",
      databaseId: "database-1",
    };
    options.onError(
      generationConflict(),
      { ...request, expectedGeneration: 1 },
      undefined,
    );
    expect(toast.error).not.toHaveBeenCalled();
    options.onError(generationConflict(), request, undefined);
    expect(toast.error).toHaveBeenCalledTimes(1);
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
