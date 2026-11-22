// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskWithFields } from "./use-tasks";

const {
  mutateAsync,
  patchCachedTask,
  setCachedTaskRecord,
  reportWriteFailure,
  trackEvent,
  cached,
  updateOptions,
} = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  patchCachedTask: vi.fn(),
  setCachedTaskRecord: vi.fn(),
  reportWriteFailure: vi.fn(),
  trackEvent: vi.fn(),
  cached: new Map<string, unknown>(),
  updateOptions: {} as {
    overlay?: (taskId: string) => unknown;
    onReload?: () => void;
  },
}));

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));
vi.mock("@agent-native/core/client/write-failure", () => ({
  reportWriteFailure,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("./use-tasks", () => ({
  useUpdateTask: (options: { overlay?: (taskId: string) => unknown }) => {
    Object.assign(updateOptions, options);
    return { mutateAsync, isPending: false };
  },
  useReadCachedTask: () => (taskId: string) => cached.get(taskId),
  usePatchCachedTask: () => patchCachedTask,
  useSetCachedTaskRecord: () => setCachedTaskRecord,
  useOnListTasksReload: (onReload: () => void) => {
    updateOptions.onReload = onReload;
  },
}));

import {
  applyTaskChange,
  mergeTaskChanges,
  taskChangeBetween,
  useTaskSave,
  withoutTaskPaths,
} from "./use-task-save";

const conflict = (current: unknown, currentRevision: string) =>
  Object.assign(new Error("changed"), {
    statusCode: 409,
    errorCode: "save_conflict",
    details: { current, currentRevision },
  });

function task(
  patch: Partial<TaskWithFields> & { estimate?: number },
): TaskWithFields {
  const { estimate, ...rest } = patch;
  return {
    id: "t1",
    title: "Write brief",
    done: false,
    sortOrder: 0,
    ownerEmail: "alice@example.com",
    createdAt: "2026-06-22T10:00:00.000Z",
    updatedAt: "2026-06-22T10:00:00.000Z",
    revision: "rev-1",
    fields: [
      {
        id: "estimate",
        title: "Estimate",
        type: "number",
        value: estimate ?? null,
      } as NonNullable<TaskWithFields["fields"]>[number],
    ],
    ...rest,
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function findText(text: string): HTMLElement | undefined {
  return [...document.body.querySelectorAll<HTMLElement>("*")].find(
    (element) => element.children.length === 0 && element.textContent === text,
  );
}

let shown: TaskWithFields;

function setup() {
  let hook!: ReturnType<typeof useTaskSave>;
  function Host() {
    hook = useTaskSave();
    return hook.conflictPrompt;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<Host />));
  return {
    save: (
      change: Parameters<typeof hook.save>[1],
      on: TaskWithFields = shown,
      startedFrom?: TaskWithFields,
    ) => hook.save(on, change, startedFrom),
  };
}

const flush = () => act(async () => {});

beforeEach(() => {
  mutateAsync.mockReset();
  patchCachedTask.mockClear();
  setCachedTaskRecord.mockClear();
  reportWriteFailure.mockClear();
  trackEvent.mockClear();
  cached.clear();
  shown = task({});
  cached.set("t1", shown);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe("taskChangeBetween", () => {
  it("sends only what changed, and a cleared field as null", () => {
    const from = { title: "A", done: false, fields: { a: 1, b: "x" } };
    const to = applyTaskChange(from, {
      done: true,
      fieldValues: [
        { fieldId: "a", value: null },
        { fieldId: "c", value: ["o1"] },
      ],
    });

    expect(taskChangeBetween(from, to)).toEqual({
      done: true,
      fieldValues: [
        { fieldId: "a", value: null },
        { fieldId: "c", value: ["o1"] },
      ],
    });
    expect(taskChangeBetween(from, from)).toEqual({});
  });
});

describe("mergeTaskChanges and withoutTaskPaths", () => {
  it("keeps the latest value per field, and drops the paths asked", () => {
    const merged = mergeTaskChanges(
      { title: "A", fieldValues: [{ fieldId: "a", value: 1 }] },
      {
        title: "AB",
        done: true,
        fieldValues: [
          { fieldId: "a", value: 2 },
          { fieldId: "b", value: null },
        ],
      },
    );

    expect(merged).toEqual({
      title: "AB",
      done: true,
      fieldValues: [
        { fieldId: "a", value: 2 },
        { fieldId: "b", value: null },
      ],
    });
    expect(withoutTaskPaths(merged, ["title", "fields.a"])).toEqual({
      done: true,
      fieldValues: [{ fieldId: "b", value: null }],
    });
  });
});

describe("useTaskSave", () => {
  it("saves a change against the revision it was read at", async () => {
    mutateAsync.mockResolvedValueOnce(task({ done: true, revision: "rev-2" }));
    const { save } = setup();

    await act(() => save({ done: true }));

    expect(patchCachedTask).toHaveBeenCalledWith("t1", { done: true });
    expect(mutateAsync).toHaveBeenCalledWith({
      taskId: "t1",
      done: true,
      expectedRevision: "rev-1",
    });
  });

  it("merges onto another writer's change to something else without asking", async () => {
    mutateAsync.mockRejectedValueOnce(
      conflict(
        { title: "Theirs", done: false, fields: { estimate: 5 } },
        "rev-2",
      ),
    );
    mutateAsync.mockResolvedValueOnce(
      task({ title: "Theirs", done: true, estimate: 5, revision: "rev-3" }),
    );
    const { save } = setup();

    await act(() => save({ done: true }));

    expect(mutateAsync).toHaveBeenLastCalledWith({
      taskId: "t1",
      done: true,
      expectedRevision: "rev-2",
    });
    expect(findText("saveConflict.title")).toBeUndefined();
  });

  it("asks when both changed the same field, and saves the choice", async () => {
    mutateAsync.mockRejectedValueOnce(
      conflict(
        { title: "Write brief", done: false, fields: { estimate: 5 } },
        "rev-2",
      ),
    );
    mutateAsync.mockResolvedValueOnce(task({ estimate: 3, revision: "rev-3" }));
    const { save } = setup();

    let saving!: Promise<void>;
    act(() => {
      saving = save({ fieldValues: [{ fieldId: "estimate", value: 3 }] });
    });
    await flush();

    expect(findText("saveConflict.title")).toBeTruthy();
    expect(findText("saveConflict.changedByBoth")).toBeTruthy();
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      findText("saveConflict.keepMine")?.click();
      await saving;
    });

    expect(mutateAsync).toHaveBeenLastCalledWith({
      taskId: "t1",
      fieldValues: [{ fieldId: "estimate", value: 3 }],
      expectedRevision: "rev-2",
    });
  });

  it("shows edits at once, and sends those made while a save is out as one save from its revision", async () => {
    let land!: (value: TaskWithFields) => void;
    mutateAsync.mockReturnValueOnce(
      new Promise<TaskWithFields>((resolve) => {
        land = resolve;
      }),
    );
    mutateAsync.mockResolvedValueOnce(
      task({ title: "Write the briefs", done: true, revision: "rev-3" }),
    );
    const { save } = setup();

    let saves: Promise<void>[] = [];
    act(() => {
      saves = [
        save({ done: true }),
        save({ title: "Write the brief" }, task({ done: true })),
        save(
          { title: "Write the briefs" },
          task({ title: "Write the brief", done: true }),
        ),
      ];
    });
    await flush();
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(patchCachedTask).toHaveBeenLastCalledWith("t1", {
      title: "Write the briefs",
    });
    expect(updateOptions.overlay?.("t1")).toEqual({
      title: "Write the briefs",
    });
    patchCachedTask.mockClear();
    updateOptions.onReload?.();
    expect(patchCachedTask).toHaveBeenCalledWith("t1", {
      done: true,
      title: "Write the briefs",
    });

    await act(async () => {
      land(task({ done: true, revision: "rev-2" }));
      await Promise.all(saves);
    });

    expect(setCachedTaskRecord).toHaveBeenCalledWith(
      "t1",
      { title: "Write brief", done: true, fields: {} },
      "rev-2",
    );
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync).toHaveBeenLastCalledWith({
      taskId: "t1",
      title: "Write the briefs",
      expectedRevision: "rev-2",
    });
    expect(updateOptions.overlay?.("t1")).toBeUndefined();
  });

  it("drops queued edits to a field when the other version is chosen for it, and shows that version", async () => {
    let fail!: (error: unknown) => void;
    mutateAsync.mockReturnValueOnce(
      new Promise<TaskWithFields>((_resolve, reject) => {
        fail = reject;
      }),
    );
    mutateAsync.mockRejectedValueOnce(
      conflict(
        { title: "Write brief", done: false, fields: { estimate: 5 } },
        "rev-2",
      ),
    );
    mutateAsync.mockResolvedValueOnce(
      task({ done: true, estimate: 5, revision: "rev-3" }),
    );
    const { save } = setup();

    let saves: Promise<void>[] = [];
    act(() => {
      saves = [
        save({ fieldValues: [{ fieldId: "estimate", value: 3 }] }),
        save(
          { fieldValues: [{ fieldId: "estimate", value: 4 }] },
          task({ estimate: 3 }),
        ),
        save({ done: true }, task({ estimate: 4 })),
      ];
    });
    expect(updateOptions.overlay?.("t1")).toEqual({
      done: true,
      fieldValues: [{ fieldId: "estimate", value: 4 }],
    });
    await act(async () => {
      fail(
        conflict(
          { title: "Write brief", done: false, fields: { estimate: 5 } },
          "rev-2",
        ),
      );
    });
    await flush();
    expect(findText("saveConflict.title")).toBeTruthy();

    await act(async () => {
      findText("saveConflict.useTheirs")?.click();
      await Promise.all(saves);
    });

    expect(setCachedTaskRecord).toHaveBeenCalledWith(
      "t1",
      { title: "Write brief", done: false, fields: { estimate: 5 } },
      "rev-2",
    );
    expect(mutateAsync).toHaveBeenCalledTimes(3);
    expect(mutateAsync).toHaveBeenNthCalledWith(2, {
      taskId: "t1",
      done: true,
      expectedRevision: "rev-1",
    });
    expect(mutateAsync).toHaveBeenLastCalledWith({
      taskId: "t1",
      done: true,
      expectedRevision: "rev-2",
    });
  });

  it("checks an edit queued behind a merged save against what it was made from", async () => {
    let fail!: (error: unknown) => void;
    mutateAsync.mockReturnValueOnce(
      new Promise<TaskWithFields>((_resolve, reject) => {
        fail = reject;
      }),
    );
    mutateAsync.mockResolvedValueOnce(
      task({ title: "Write the brief", estimate: 5, revision: "rev-3" }),
    );
    mutateAsync.mockRejectedValueOnce(
      conflict(
        { title: "Write the brief", done: false, fields: { estimate: 5 } },
        "rev-3",
      ),
    );
    mutateAsync.mockResolvedValueOnce(
      task({ title: "Write the brief", estimate: 4, revision: "rev-4" }),
    );
    const { save } = setup();

    let saves: Promise<void>[] = [];
    act(() => {
      saves = [
        save({ title: "Write the brief" }),
        save(
          { fieldValues: [{ fieldId: "estimate", value: 4 }] },
          task({ title: "Write the brief" }),
        ),
      ];
    });
    await act(async () => {
      fail(
        conflict(
          { title: "Write brief", done: false, fields: { estimate: 5 } },
          "rev-2",
        ),
      );
    });
    await flush();
    await flush();

    expect(mutateAsync).toHaveBeenNthCalledWith(2, {
      taskId: "t1",
      title: "Write the brief",
      expectedRevision: "rev-2",
    });
    expect(mutateAsync).toHaveBeenNthCalledWith(3, {
      taskId: "t1",
      fieldValues: [{ fieldId: "estimate", value: 4 }],
      expectedRevision: "rev-1",
    });
    expect(findText("saveConflict.title")).toBeTruthy();

    await act(async () => {
      findText("saveConflict.keepMine")?.click();
      await Promise.all(saves);
    });

    expect(mutateAsync).toHaveBeenCalledTimes(4);
    expect(mutateAsync).toHaveBeenLastCalledWith({
      taskId: "t1",
      fieldValues: [{ fieldId: "estimate", value: 4 }],
      expectedRevision: "rev-3",
    });
  });

  it("checks a save against the version its edit started from", async () => {
    mutateAsync.mockRejectedValueOnce(
      conflict({ title: "Their title", done: false, fields: {} }, "rev-2"),
    );
    mutateAsync.mockResolvedValueOnce(
      task({ title: "My title", revision: "rev-3" }),
    );
    const { save } = setup();
    const refreshed = task({ title: "Their title", revision: "rev-2" });

    let saving!: Promise<void>;
    act(() => {
      saving = save({ title: "My title" }, refreshed, shown);
    });
    await flush();

    expect(mutateAsync).toHaveBeenCalledWith({
      taskId: "t1",
      title: "My title",
      expectedRevision: "rev-1",
    });
    expect(findText("saveConflict.title")).toBeTruthy();

    await act(async () => {
      findText("saveConflict.keepMine")?.click();
      await saving;
    });
    expect(mutateAsync).toHaveBeenLastCalledWith({
      taskId: "t1",
      title: "My title",
      expectedRevision: "rev-2",
    });
  });

  it("reports a failed restore of the other version", async () => {
    const offline = new Error("offline");
    mutateAsync.mockRejectedValueOnce(
      conflict(
        { title: "Write brief", done: false, fields: { estimate: 5 } },
        "rev-2",
      ),
    );
    mutateAsync.mockResolvedValueOnce(task({ estimate: 3, revision: "rev-3" }));
    mutateAsync.mockRejectedValueOnce(offline);
    const { save } = setup();

    let saving!: Promise<void>;
    act(() => {
      saving = save({ fieldValues: [{ fieldId: "estimate", value: 3 }] });
    });
    await flush();
    await act(async () => {
      findText("saveConflict.keepMine")?.click();
      await saving;
    });
    await flush();
    cached.set("t1", task({ estimate: 3, revision: "rev-3" }));

    await act(async () => {
      findText("saveConflict.getOtherBack")?.click();
    });
    await flush();

    expect(mutateAsync).toHaveBeenLastCalledWith({
      taskId: "t1",
      fieldValues: [{ fieldId: "estimate", value: 5 }],
      expectedRevision: "rev-3",
    });
    expect(reportWriteFailure).toHaveBeenCalledWith(offline);
  });

  it("saves without a revision when the task wasn't read with one, then uses the one it got back", async () => {
    const { fields: _fields, revision: _revision, ...unread } = shown;
    let land!: (value: TaskWithFields) => void;
    mutateAsync.mockReturnValueOnce(
      new Promise<TaskWithFields>((resolve) => {
        land = resolve;
      }),
    );
    mutateAsync.mockResolvedValueOnce(
      task({ title: "Write the brief", done: true, revision: "rev-3" }),
    );
    const { save } = setup();

    let saves: Promise<void>[] = [];
    act(() => {
      saves = [
        save({ done: true }, unread),
        save({ title: "Write the brief" }, unread),
      ];
    });
    await flush();
    expect(mutateAsync).toHaveBeenCalledWith({ taskId: "t1", done: true });

    await act(async () => {
      land(task({ done: true, revision: "rev-2" }));
      await Promise.all(saves);
    });

    expect(mutateAsync).toHaveBeenLastCalledWith({
      taskId: "t1",
      title: "Write the brief",
      expectedRevision: "rev-2",
    });
  });
});
