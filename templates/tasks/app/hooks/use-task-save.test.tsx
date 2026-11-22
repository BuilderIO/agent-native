// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskWithFields } from "./use-tasks";

const { mutateAsync, trackEvent, cached } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  trackEvent: vi.fn(),
  cached: new Map<string, unknown>(),
}));

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("./use-tasks", () => ({
  useUpdateTask: () => ({ mutateAsync, isPending: false }),
  useReadCachedTask: () => (taskId: string) => cached.get(taskId),
}));

import {
  applyTaskChange,
  taskChangeBetween,
  useTaskSave,
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
    save: (change: Parameters<typeof hook.save>[1]) => hook.save("t1", change),
  };
}

const flush = () => act(async () => {});

beforeEach(() => {
  mutateAsync.mockReset();
  trackEvent.mockClear();
  cached.clear();
  cached.set("t1", task({}));
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

describe("useTaskSave", () => {
  it("saves a change against the revision it was read at", async () => {
    mutateAsync.mockResolvedValueOnce(task({ done: true, revision: "rev-2" }));
    const { save } = setup();

    await act(() => save({ done: true }));

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

  it("sends a task's changes one at a time, each from the save before it", async () => {
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

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = save({ done: true });
      second = save({ title: "Write the brief" });
    });
    await flush();
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      land(task({ done: true, revision: "rev-2" }));
      await Promise.all([first, second]);
    });

    expect(mutateAsync).toHaveBeenLastCalledWith({
      taskId: "t1",
      title: "Write the brief",
      expectedRevision: "rev-2",
    });
  });

  it("saves without a revision when the task wasn't read with one", async () => {
    cached.clear();
    mutateAsync.mockResolvedValueOnce(task({ done: true }));
    const { save } = setup();

    await act(() => save({ done: true }));

    expect(mutateAsync).toHaveBeenCalledWith({ taskId: "t1", done: true });
  });
});
