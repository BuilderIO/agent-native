import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Cell } from "@/lib/model/contracts";

// The two notebook helpers read the model through the app alias, which this
// config does not resolve; the inline stand-ins keep the render checks about
// collapse markup rather than about cell copying.
vi.mock("./utils", () => ({
  cellIsRunnable: (kind: string) => kind === "sql" || kind === "code",
  cellUsesConnection: (kind: string) => kind === "sql",
  describeCell: () => "Query cell",
  editableCellText: (contents: { kind: string; source?: string }) =>
    contents.kind === "sql" || contents.kind === "code"
      ? (contents.source ?? "")
      : null,
  formatCellValue: (value: unknown) => String(value),
  formatOutputSummary: () => "1 row",
  isRunningStatus: (status?: string) => status === "running",
  toNotebookError: (error: unknown) => ({ message: String(error) }),
}));

import { CollapsedCellPlaceholder, NotebookCell } from "./NotebookCell";
import {
  cellCollapseStorageKey,
  createCollapseStore,
  type CellCollapseIdentity,
  type CollapseStorage,
  type CollapseStore,
  useCellCollapsed,
} from "./useCellCollapse";

/** A Web Storage stand-in so the checks never touch a real browser store. */
function memoryStorage(
  options: { failRead?: boolean; failWrite?: boolean } = {},
): CollapseStorage & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem(key) {
      if (options.failRead) throw new Error("storage read blocked");
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      if (options.failWrite) throw new Error("storage write blocked");
      entries.set(key, value);
    },
    removeItem(key) {
      entries.delete(key);
    },
  };
}

function storeOver(storage: CollapseStorage | null): CollapseStore {
  return createCollapseStore(() => storage);
}

const CELL_A: CellCollapseIdentity = {
  cellId: "cell-a",
  projectId: "project-a",
  workspaceId: "workspace-a",
};
const CELL_B: CellCollapseIdentity = {
  cellId: "cell-b",
  projectId: "project-a",
  workspaceId: "workspace-a",
};

function sqlCell(id: string, projectId: string): Cell {
  return {
    id,
    projectId,
    versionId: "version-a",
    createdAt: "2026-11-05T12:00:00.000Z",
    updatedAt: "2026-11-05T12:00:00.000Z",
    contents: {
      id,
      order: "i",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      kind: "sql",
      source: "select 1 as one",
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: null,
      outputResult: true,
    },
  };
}

/** The smallest component that exercises the hook without a DOM. */
function CollapseHarness({ identity }: { identity: CellCollapseIdentity }) {
  const state = useCellCollapsed(identity);
  return (
    <span data-harness="collapse">
      {`${state.sourceCollapsed ? "collapsed" : "expanded"}/${
        state.outputCollapsed ? "collapsed" : "expanded"
      }`}
    </span>
  );
}

describe("remembered cell collapse keys", () => {
  it("keeps source and output preferences apart for the same cell", () => {
    const source = cellCollapseStorageKey(CELL_A, "source");
    const output = cellCollapseStorageKey(CELL_A, "output");
    expect(source).not.toBeNull();
    expect(output).not.toBeNull();
    expect(source).not.toBe(output);
  });

  it("keeps two cells in one project apart", () => {
    expect(cellCollapseStorageKey(CELL_A, "source")).not.toBe(
      cellCollapseStorageKey(CELL_B, "source"),
    );
  });

  it("keeps one cell id apart across projects and workspaces", () => {
    const keys = new Set([
      cellCollapseStorageKey(CELL_A, "output"),
      cellCollapseStorageKey({ ...CELL_A, projectId: "project-b" }, "output"),
      cellCollapseStorageKey(
        { ...CELL_A, workspaceId: "workspace-b" },
        "output",
      ),
    ]);
    expect(keys.size).toBe(3);
  });

  it("cannot be read across a separator smuggled into an id", () => {
    const smuggled = cellCollapseStorageKey(
      { cellId: "a", projectId: "p:cell-b" },
      "source",
    );
    const plain = cellCollapseStorageKey(
      { cellId: "b", projectId: "p" },
      "source",
    );
    expect(smuggled).not.toBe(plain);
  });

  it("declines to persist an identity with no cell id", () => {
    expect(cellCollapseStorageKey({ cellId: "   " }, "source")).toBeNull();
  });
});

describe("collapse preferences survive a reload", () => {
  it("reads a stored preference back in a fresh store", () => {
    const storage = memoryStorage();
    const key = cellCollapseStorageKey(CELL_A, "source");
    storeOver(storage).set(key, true);

    expect(storeOver(storage).get(key)).toBe(true);
    expect(storage.entries.get(key ?? "")).toBe("true");
  });

  it("starts expanded when nothing was ever stored", () => {
    expect(
      storeOver(memoryStorage()).get(cellCollapseStorageKey(CELL_A, "source")),
    ).toBe(false);
  });

  it("holds the two halves of one cell independently across a reload", () => {
    const storage = memoryStorage();
    const sourceKey = cellCollapseStorageKey(CELL_A, "source");
    const outputKey = cellCollapseStorageKey(CELL_A, "output");
    const first = storeOver(storage);
    first.set(sourceKey, true);
    first.set(outputKey, false);

    const reloaded = storeOver(storage);
    expect(reloaded.get(sourceKey)).toBe(true);
    expect(reloaded.get(outputKey)).toBe(false);
  });

  it("holds two cells independently across a reload", () => {
    const storage = memoryStorage();
    const aKey = cellCollapseStorageKey(CELL_A, "source");
    const bKey = cellCollapseStorageKey(CELL_B, "source");
    const first = storeOver(storage);
    first.set(aKey, true);

    const reloaded = storeOver(storage);
    expect(reloaded.get(aKey)).toBe(true);
    expect(reloaded.get(bKey)).toBe(false);
  });
});

describe("unreadable or unavailable storage", () => {
  it("treats malformed stored values as unset instead of collapsed", () => {
    const storage = memoryStorage();
    const key = cellCollapseStorageKey(CELL_A, "source") ?? "";
    storage.entries.set(key, "{not json");
    expect(storeOver(storage).get(key)).toBe(false);

    storage.entries.set(key, JSON.stringify("true"));
    expect(storeOver(storage).get(key)).toBe(false);

    storage.entries.set(key, JSON.stringify(false));
    expect(storeOver(storage).get(key)).toBe(false);
  });

  it("still toggles and notifies when storage throws on read and write", () => {
    const storage = memoryStorage({ failRead: true, failWrite: true });
    const store = storeOver(storage);
    const key = cellCollapseStorageKey(CELL_A, "output");
    let notifications = 0;
    const unsubscribe = store.subscribe(key, () => {
      notifications += 1;
    });

    store.set(key, true);
    expect(store.get(key)).toBe(true);
    store.set(key, false);
    expect(store.get(key)).toBe(false);
    expect(notifications).toBe(2);
    unsubscribe();
  });

  it("keeps the toggle when the write is refused but reads still work", () => {
    const storage = memoryStorage({ failWrite: true });
    const store = storeOver(storage);
    const key = cellCollapseStorageKey(CELL_A, "source");
    store.set(key, true);
    expect(store.get(key)).toBe(true);
    expect(storage.entries.size).toBe(0);
  });

  it("toggles in memory when there is no storage at all", () => {
    const store = storeOver(null);
    const key = cellCollapseStorageKey(CELL_A, "source");
    expect(store.get(key)).toBe(false);
    store.set(key, true);
    expect(store.get(key)).toBe(true);
    store.set(null, true);
    expect(store.get(null)).toBe(false);
  });

  it("only notifies readers of the key that changed", () => {
    const store = storeOver(memoryStorage());
    const sourceKey = cellCollapseStorageKey(CELL_A, "source");
    const outputKey = cellCollapseStorageKey(CELL_A, "output");
    let sourceHits = 0;
    const unsubscribe = store.subscribe(sourceKey, () => {
      sourceHits += 1;
    });
    store.set(outputKey, true);
    expect(sourceHits).toBe(0);
    store.set(sourceKey, true);
    expect(sourceHits).toBe(1);
    unsubscribe();
    store.set(sourceKey, false);
    expect(sourceHits).toBe(1);
  });
});

describe("rendering without a browser", () => {
  it("renders the hook expanded on the server and never throws", () => {
    const html = renderToStaticMarkup(<CollapseHarness identity={CELL_A} />);
    expect(html).toContain("expanded/expanded");
  });

  it("renders one line of italic placeholder text for a collapsed half", () => {
    const code = renderToStaticMarkup(
      <CollapsedCellPlaceholder label="Code collapsed" onExpand={() => {}} />,
    );
    expect(code).toContain("nb-cell-collapsed");
    expect(code).toContain("nb-collapsed-button");
    expect(code).toContain("Code collapsed");

    const result = renderToStaticMarkup(
      <CollapsedCellPlaceholder label="Result collapsed" onExpand={() => {}} />,
    );
    expect(result).toContain("Result collapsed");
  });

  it("report 1794948257.991429 shows the latest run time", () => {
    const cell = sqlCell("cell-a", "project-a");
    const html = renderToStaticMarkup(
      <NotebookCell
        cell={cell}
        title="SQL 1"
        connections={[]}
        canEdit
        busy={false}
        running={false}
        saving={false}
        deleting={false}
        connectionPending={false}
        connectionId={null}
        draftText="select 1"
        dirty={false}
        stale={false}
        outputState={{ ranAt: "2026-11-17T12:00:00.000Z" }}
        error={null}
        onTextChange={() => {}}
        onSaveDraft={() => {}}
        onRun={() => {}}
        onDiscard={() => {}}
        onOverwrite={() => {}}
        onDelete={() => {}}
        onSelectConnection={() => {}}
        onDismissError={() => {}}
        onRetryError={() => {}}
      />,
    );
    expect(html).toContain('dateTime="2026-11-17T12:00:00.000Z"');
  });

  it("names the source control exactly Expand and Collapse", () => {
    const cell = sqlCell("cell-a", "project-a");
    const html = renderToStaticMarkup(
      <NotebookCell
        cell={cell}
        title="Query 1"
        connections={[]}
        canEdit
        busy={false}
        running={false}
        onSaveDraft={() => {}}
        saving={false}
        deleting={false}
        connectionPending={false}
        connectionId={null}
        draftText="select 1 as one"
        dirty={false}
        stale={false}
        outputState={undefined}
        error={null}
        onTextChange={() => {}}
        onRun={() => {}}
        onDiscard={() => {}}
        onOverwrite={() => {}}
        onDelete={() => {}}
        onSelectConnection={() => {}}
        onDismissError={() => {}}
        onRetryError={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Collapse"');
    expect(html).not.toContain("Code collapsed");
    expect(html).toContain("select 1 as one");
  });
});

describe("collapse preference identity boundaries", () => {
  it("keeps punctuation-distinct cell ids independent", () => {
    const keys = ["cell:a", "cell_a", "cell-a"].map((cellId) =>
      cellCollapseStorageKey({ ...CELL_A, cellId }, "source"),
    );
    expect(new Set(keys).size).toBe(3);
  });

  it("does not alias an omitted workspace with an omitted project", () => {
    expect(
      cellCollapseStorageKey(
        { cellId: "cell-a", projectId: "scope-a" },
        "output",
      ),
    ).not.toBe(
      cellCollapseStorageKey(
        { cellId: "cell-a", workspaceId: "scope-a" },
        "output",
      ),
    );
  });
});

describe("collapse preference unavailable reads", () => {
  it("keeps the current toggle when a write succeeds but reads fail", () => {
    const storage = memoryStorage({ failRead: true });
    const store = storeOver(storage);
    const key = cellCollapseStorageKey(CELL_A, "source");
    store.set(key, true);
    expect(store.get(key)).toBe(true);
    store.set(key, false);
    expect(store.get(key)).toBe(false);
  });
});
