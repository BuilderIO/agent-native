// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Cell, CellContents } from "@/lib/model/contracts";

import { useCellDrafts } from "./useCellDrafts";

// A same-document route change (a collection link, browser Back) unmounts the
// notebook without hiding or unloading the document, so neither
// visibilitychange nor pagehide runs. The 500 ms autosave queued by the last
// keystroke has to survive that exit; today it is cancelled and the reopened
// notebook shows the older body.

const CANONICAL_START = "select 1";
const TYPED = "select 2";

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.useRealTimers();
});

function cellWith(source: string): Cell {
  return {
    id: "cell-1",
    kind: "sql",
    contents: { kind: "sql", source },
  } as unknown as Cell;
}

/** Stands in for the persisted notebook the editor reads and saves through. */
function createDocument(source: string) {
  const doc = { source, saves: [] as string[] };
  return {
    cells: (): Cell[] => [cellWith(doc.source)],
    onSaveCell: async (_cellId: string, contents: CellContents) => {
      const text = contents.kind === "sql" ? contents.source : undefined;
      if (text != null) {
        doc.source = text;
        doc.saves.push(text);
      }
    },
    doc,
  };
}

function Editor({
  document: store,
}: {
  document: ReturnType<typeof createDocument>;
}) {
  const drafts = useCellDrafts({
    cells: store.cells(),
    onSaveCell: store.onSaveCell,
  });
  const cell = store.cells()[0]!;
  return (
    <textarea
      aria-label="SQL cell"
      value={drafts.textFor(cell)}
      onChange={(event) => drafts.update(cell, event.target.value)}
    />
  );
}

/** Routes between the collection list and the notebook, like the real pages. */
function Host({
  view,
  store,
}: {
  view: "collection" | "notebook";
  store: ReturnType<typeof createDocument>;
}) {
  return view === "notebook" ? <Editor document={store} /> : <p>Collection</p>;
}

function textarea(): HTMLTextAreaElement {
  const element = container.querySelector("textarea");
  if (element == null) throw new Error("no textarea in the editor");
  return element as HTMLTextAreaElement;
}

/** Types through the same onChange binding NotebookCell uses. */
async function type(value: string) {
  const element = textarea();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function render(
  view: "collection" | "notebook",
  store: ReturnType<typeof createDocument>,
) {
  act(() => {
    root?.unmount();
    root = createRoot(container);
    root.render(<Host view={view} store={store} />);
  });
}

it("keeps the typed edit when a same-document route exit unmounts the notebook", async () => {
  const store = createDocument(CANONICAL_START);
  render("notebook", store);
  expect(textarea().value).toBe(CANONICAL_START);

  await type(TYPED);
  // Only 100 ms of the 500 ms debounce has elapsed when the person goes Back.
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  render("collection", store);
  await act(async () => {
    vi.advanceTimersByTime(600);
    await Promise.resolve();
  });
  expect(store.doc.source).toBe(TYPED);

  // Reopening the notebook from the same document shows the new body.
  render("notebook", store);
  expect(textarea().value).toBe(TYPED);
});

it("still lets a cancelled draft stay cancelled", async () => {
  const store = createDocument(CANONICAL_START);
  render("notebook", store);
  await type(TYPED);
  await act(async () => {
    vi.advanceTimersByTime(600);
    await Promise.resolve();
  });
  expect(store.doc.saves).toEqual([TYPED]);
});
