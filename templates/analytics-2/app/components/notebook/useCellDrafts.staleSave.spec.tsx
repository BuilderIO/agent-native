// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Cell, CellContents } from "@/lib/model/contracts";

import { useCellDrafts, type CellDrafts } from "./useCellDrafts";

/**
 * sprint-analytics-2#175: "editing a sent query and resending returns the first
 * query's results". Run saves through the same path, and a save callback that was
 * created before the newest keystroke used to read the older draft out of its
 * closure - so the warehouse ran the previous SQL while the newest text sat in
 * state. The newest draft now comes from a ref, so a stale callback still writes
 * what the person can see.
 */
const START = "select 1";
const TYPED = "select 2";
const RETYPED = "select 3";
const REMOTE = "select 4";

let container: HTMLDivElement;
let root: Root | undefined;
let draftsRef: CellDrafts | undefined;
const saved: string[] = [];
const savedRevisions: Array<string | undefined> = [];

function cellWith(source: string, updatedAt = "revision-1"): Cell {
  return {
    id: "cell-1",
    kind: "sql",
    updatedAt,
    contents: { kind: "sql", source },
  } as unknown as Cell;
}

function Harness({
  cells,
  onSaveCell,
}: {
  cells: Cell[];
  onSaveCell: (id: string, c: CellContents) => Promise<string | void>;
}) {
  const drafts = useCellDrafts({ cells, onSaveCell });
  draftsRef = drafts;
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  saved.length = 0;
  savedRevisions.length = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.useRealTimers();
});

const onSaveCell = async (
  _id: string,
  contents: CellContents,
  expectedUpdatedAt?: string,
) => {
  savedRevisions.push(expectedUpdatedAt);
  if (contents.kind === "sql") saved.push(contents.source);
  return "revision-3";
};

describe("a save captured before the newest keystroke", () => {
  it("writes the newest text, not the text it closed over", async () => {
    const cells = [cellWith(START)];
    act(() => root?.render(<Harness cells={cells} onSaveCell={onSaveCell} />));

    // The callback Run holds on to, created while the cell still read `select 2`.
    act(() => draftsRef?.update(cells[0]!, TYPED));
    const saveCapturedBefore = draftsRef!.save;

    // The person keeps typing; a re-render happens with the newer draft.
    act(() => draftsRef?.update(cells[0]!, RETYPED));
    act(() => root?.render(<Harness cells={cells} onSaveCell={onSaveCell} />));

    await act(async () => {
      await saveCapturedBefore(cells[0]!);
    });

    expect(saved.at(-1)).toBe(RETYPED);
  });

  it("does not autosave a dirty draft after a newer revision arrives", async () => {
    vi.useFakeTimers();
    const cells = [cellWith(START)];
    act(() => root?.render(<Harness cells={cells} onSaveCell={onSaveCell} />));
    act(() => draftsRef?.update(cells[0]!, TYPED));

    const changedElsewhere = [cellWith(REMOTE, "revision-2")];
    act(() =>
      root?.render(
        <Harness cells={changedElsewhere} onSaveCell={onSaveCell} />,
      ),
    );
    expect(draftsRef!.isStale(changedElsewhere[0]!)).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    expect(saved).toEqual([]);
    expect(draftsRef!.textFor(changedElsewhere[0]!)).toBe(TYPED);

    await act(async () => {
      await draftsRef!.save(changedElsewhere[0]!, undefined, false, true);
    });
    expect(saved).toEqual([TYPED]);
    expect(savedRevisions).toEqual(["revision-2"]);
  });
});

it("report A2-AUTOSAVE-RUN-DROPPED: preserves newer text while an earlier save completes", async () => {
  const cell = cellWith(START);
  const first = deferredValue<string>();
  const write = vi.fn(() => first.promise);
  act(() => root?.render(<Harness cells={[cell]} onSaveCell={write} />));
  assert(draftsRef);
  act(() => draftsRef?.update(cell, TYPED));
  const saving = draftsRef.save(cell);
  act(() => draftsRef?.update(cell, RETYPED));
  await act(async () => {
    first.resolve("revision-2");
    await saving;
  });
  assert(draftsRef);
  expect(draftsRef.textFor(cell)).toBe(RETYPED);
  expect(draftsRef.isDirty(cell)).toBe(true);
});

it("report A2-AUTOSAVE-RUN-DROPPED: a failed in-flight save retains newer text and blocks the queued run", async () => {
  const cell = cellWith(START);
  const first = deferredValue<string>();
  const write = vi.fn(() => first.promise);
  act(() => root?.render(<Harness cells={[cell]} onSaveCell={write} />));
  assert(draftsRef);
  act(() => draftsRef?.update(cell, TYPED));
  const saving = draftsRef.save(cell);
  act(() => draftsRef?.update(cell, RETYPED));
  assert(draftsRef);
  const runSave = draftsRef.save(cell);
  await act(async () => {
    first.reject(new Error("save failed"));
    await saving;
    expect(await runSave).toBe(false);
  });
  assert(draftsRef);
  expect(write).toHaveBeenCalledTimes(1);
  expect(draftsRef.textFor(cell)).toBe(RETYPED);
  expect(draftsRef.drafts[cell.id]?.error).not.toBeNull();
});

it("report A2-AUTOSAVE-RUN-DROPPED: concurrent waiters share the acknowledged newest save before running", async () => {
  const cell = cellWith(START);
  const first = deferredValue<string>();
  const latest = deferredValue<string>();
  const write = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValue(latest.promise);
  act(() => root?.render(<Harness cells={[cell]} onSaveCell={write} />));
  assert(draftsRef);
  act(() => draftsRef?.update(cell, TYPED));
  const saving = draftsRef.save(cell);
  act(() => draftsRef?.update(cell, RETYPED));
  assert(draftsRef);
  const autosave = draftsRef.save(cell);
  const runSave = draftsRef.save(cell);
  let ran = false;
  const run = runSave.then((ok) => {
    if (ok) ran = true;
    return ok;
  });
  await act(async () => {
    first.resolve("revision-2");
    await saving;
    await Promise.resolve();
  });
  expect(write).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenLastCalledWith(
    cell.id,
    expect.objectContaining({ source: RETYPED }),
    "revision-2",
  );
  expect(ran).toBe(false);
  await act(async () => {
    latest.resolve("revision-3");
    expect(await autosave).toBe(true);
    expect(await run).toBe(true);
  });
  expect(ran).toBe(true);
  expect(write).toHaveBeenCalledTimes(2);
});

function deferredValue<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred not initialized");
  };
  let reject: (reason?: unknown) => void = () => {
    throw new Error("Deferred not initialized");
  };
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it("report A2-INPUT-DRAFT-RUN: flushes a newer input edit after an in-flight save", async () => {
  const input: Cell = {
    id: "cell-1",
    projectId: "project-1",
    versionId: "version-1",
    createdAt: "revision-1",
    updatedAt: "revision-1",
    contents: {
      id: "cell-1",
      order: "a0",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      kind: "input",
      name: "Choice",
      inputType: "TEXT_INPUT",
      defaultValueString: "first",
    },
  };
  const first = deferredValue<string>();
  const write = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce("revision-3");
  act(() => root?.render(<Harness cells={[input]} onSaveCell={write} />));
  act(() => draftsRef?.update(input, "second"));
  const saving = draftsRef!.save(input);
  const flushing = draftsRef!.flushInputs(() => true);
  act(() => draftsRef?.update(input, "third"));
  await act(async () => {
    first.resolve("revision-2");
    await saving;
    expect(await flushing).toBe(true);
  });
  expect(write).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenLastCalledWith(
    input.id,
    expect.objectContaining({ defaultValueString: "third" }),
    "revision-2",
  );
});

it("report A2-AUTOSAVE-RUN-DROPPED: a late refetch of an earlier acknowledged revision does not block the next save or run", async () => {
  const cell = cellWith(START);
  const write = vi
    .fn<(id: string, c: CellContents, expected?: string) => Promise<string>>()
    .mockResolvedValueOnce("revision-2")
    .mockResolvedValueOnce("revision-3")
    .mockResolvedValue("revision-4");
  act(() => root?.render(<Harness cells={[cell]} onSaveCell={write} />));
  assert(draftsRef);
  act(() => draftsRef?.update(cell, TYPED));
  await act(async () => {
    await draftsRef?.save(cell);
  });
  act(() => draftsRef?.update(cell, RETYPED));
  await act(async () => {
    await draftsRef?.save(cell);
  });
  const lagging = cellWith(TYPED, "revision-2");
  act(() => root?.render(<Harness cells={[lagging]} onSaveCell={write} />));
  assert(draftsRef);
  expect(draftsRef.isStale(lagging)).toBe(false);
  act(() => draftsRef?.update(lagging, REMOTE));
  let ran = false;
  await act(async () => {
    ran = (await draftsRef?.save(lagging)) ?? false;
  });
  expect(ran).toBe(true);
  expect(write).toHaveBeenCalledTimes(3);
  expect(write).toHaveBeenLastCalledWith(
    cell.id,
    expect.objectContaining({ source: REMOTE }),
    "revision-3",
  );
});

it("flushInputs saves uncommitted SLIDER drafts before run", async () => {
  const slider: Cell = {
    id: "cell-slider",
    projectId: "project-1",
    versionId: "version-1",
    createdAt: "revision-1",
    updatedAt: "revision-1",
    contents: {
      id: "cell-slider",
      order: "a0",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      kind: "input",
      name: "threshold",
      inputType: "SLIDER",
      sliderOptions: { min: 0, max: 100, step: 1 },
      defaultValueString: "10",
    },
  };
  const write = vi.fn(async () => "revision-2");
  act(() => root?.render(<Harness cells={[slider]} onSaveCell={write} />));
  assert(draftsRef);
  act(() => draftsRef?.update(slider, "75", false));
  await act(async () => {
    expect(await draftsRef?.flushInputs(() => true)).toBe(true);
  });
  expect(write).toHaveBeenCalledWith(
    slider.id,
    expect.objectContaining({ defaultValueString: "75" }),
    "revision-1",
  );
});

it("discard cancels any pending debounced autosave timer", async () => {
  vi.useFakeTimers();
  try {
    const cell = cellWith(START);
    const write = vi.fn(async () => "revision-2");
    act(() => root?.render(<Harness cells={[cell]} onSaveCell={write} />));
    assert(draftsRef);
    act(() => draftsRef?.update(cell, TYPED));
    act(() => draftsRef?.discard(cell));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(write).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
