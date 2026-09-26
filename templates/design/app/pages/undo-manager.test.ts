
import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";

const LOCAL_EDIT_ORIGIN = "test-tab:local";

function makeDocWithUndoManager() {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  const um = new Y.UndoManager(ytext, {
    trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]),
    captureTimeout: 0, // each transaction is its own undo step in tests
  });
  return { ydoc, ytext, um };
}

describe("Y.UndoManager undo scoping", () => {
  let ydoc: Y.Doc;
  let ytext: Y.Text;
  let um: Y.UndoManager;

  beforeEach(() => {
    ({ ydoc, ytext, um } = makeDocWithUndoManager());
    ydoc.transact(() => {
      ytext.insert(0, "<h1>Hello</h1>");
    }, "remote");
    um.clear();
  });

  it("captures local-origin transactions in the undo stack", () => {
    expect(um.canUndo()).toBe(false);
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "<h1>World</h1>");
    }, LOCAL_EDIT_ORIGIN);
    expect(um.canUndo()).toBe(true);
    expect(um.canRedo()).toBe(false);
  });

  it("does NOT capture remote-origin transactions", () => {
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "<h1>Agent edit</h1>");
    }, "remote");
    expect(um.canUndo()).toBe(false);
  });

  it("does NOT capture null-origin transactions (framework internal)", () => {
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "<h1>Null origin</h1>");
    });
    expect(um.canUndo()).toBe(false);
  });

  it("undoes only local edits, leaving remote content intact", () => {
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "<h1>Local change</h1>");
    }, LOCAL_EDIT_ORIGIN);
    expect(ytext.toJSON()).toBe("<h1>Local change</h1>");

    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "<h1>Remote change after local</h1>");
    }, "remote");
    expect(ytext.toJSON()).toBe("<h1>Remote change after local</h1>");

    const result = um.undo();
    expect(result).not.toBeNull();
    expect(um.canRedo()).toBe(true);
  });

  it("supports redo after undo", () => {
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "<h1>Step 1</h1>");
    }, LOCAL_EDIT_ORIGIN);

    um.undo();
    expect(um.canRedo()).toBe(true);
    um.redo();
    expect(um.canRedo()).toBe(false);
    expect(um.canUndo()).toBe(true);
  });

  it("multiple local edits produce separate undo steps when captureTimeout=0", () => {
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "<h1>Step A</h1>");
    }, LOCAL_EDIT_ORIGIN);

    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "<h1>Step B</h1>");
    }, LOCAL_EDIT_ORIGIN);

    expect(um.undoStack.length).toBe(2);
    um.undo();
    expect(um.undoStack.length).toBe(1);
    um.undo();
    expect(um.canUndo()).toBe(false);
  });

  it("clears redo stack when a new local edit is made after undo", () => {
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "<h1>Edit 1</h1>");
    }, LOCAL_EDIT_ORIGIN);

    um.undo();
    expect(um.canRedo()).toBe(true);

    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "<h1>Edit 2</h1>");
    }, LOCAL_EDIT_ORIGIN);

    expect(um.canRedo()).toBe(false);
  });
});
