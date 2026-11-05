// @vitest-environment happy-dom

import type { Form, FormField } from "@shared/types";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mutateAsync, trackEvent } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("./use-forms", () => ({
  usePatchFormFields: () => ({ mutateAsync }),
}));

import { fieldOpsBetween, useFormFieldSave } from "./use-form-field-save";

const field = (id: string, label: string): FormField => ({
  id,
  type: "text",
  label,
  required: false,
});

const conflict = (current: FormField[], currentRevision: string) =>
  Object.assign(new Error("changed"), {
    statusCode: 409,
    errorCode: "save_conflict",
    details: { current, currentRevision },
  });

const form = (fields: FormField[], revision: string) =>
  ({ id: "form-1", fields, revision }) as unknown as Form;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** The element showing exactly this text, wherever the dialog portalled it. */
function findText(text: string): HTMLElement | undefined {
  return [...document.body.querySelectorAll<HTMLElement>("*")].find(
    (element) => element.children.length === 0 && element.textContent === text,
  );
}

function clickText(text: string): void {
  const element = findText(text);
  if (!element) throw new Error(`Nothing shows "${text}"`);
  element.click();
}

function setup(initial = form([field("a", "A"), field("b", "B")], "rev-1")) {
  let hook!: ReturnType<typeof useFormFieldSave>;
  function Host({ value }: { value: Form }) {
    hook = useFormFieldSave(value);
    return hook.fieldConflictPrompt;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const show = (value: Form) => act(() => root?.render(<Host value={value} />));
  show(initial);
  return {
    rerender: show,
    fields: () => hook.localFields,
    edit: (change: (fields: FormField[]) => FormField[]) =>
      act(() => hook.editFields(change)),
  };
}

const settle = () => act(() => vi.advanceTimersByTimeAsync(600));
const renamed = (id: string, label: string) => (fields: FormField[]) =>
  fields.map((item) => (item.id === id ? { ...item, label } : item));

beforeEach(() => {
  vi.useFakeTimers();
  mutateAsync.mockReset();
  trackEvent.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
});

describe("fieldOpsBetween", () => {
  it("sends only what changed", () => {
    const from = [field("a", "A"), field("b", "B"), field("c", "C")];
    const to = [field("a", "A"), field("b", "Bee"), field("d", "D")];

    expect(fieldOpsBetween(from, to)).toEqual([
      { op: "remove", id: "c" },
      { op: "upsert", field: field("b", "Bee") },
      { op: "upsert", field: field("d", "D") },
    ]);
  });

  it("reorders only when upserts wouldn't leave the fields in order", () => {
    const a = field("a", "A");
    const b = field("b", "B");
    const from = [a, b];

    expect(fieldOpsBetween(from, [b, a])).toEqual([
      { op: "reorder", ids: ["b", "a"] },
    ]);
    expect(fieldOpsBetween(from, [field("d", "D"), a, b])).toEqual([
      { op: "upsert", field: field("d", "D") },
      { op: "reorder", ids: ["d", "a", "b"] },
    ]);
    expect(fieldOpsBetween(from, from)).toEqual([]);
  });
});

describe("useFormFieldSave", () => {
  it("saves an edit against the revision it started from", async () => {
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Mine"), field("b", "B")],
      revision: "rev-2",
    });
    const { edit } = setup();

    edit(renamed("a", "Mine"));
    await settle();

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "form-1",
      expectedRevision: "rev-1",
      ops: [{ op: "upsert", field: field("a", "Mine") }],
    });
  });

  it("merges a change to another field without asking", async () => {
    const theirs = [field("a", "A"), field("b", "Theirs")];
    mutateAsync.mockRejectedValueOnce(conflict(theirs, "rev-2"));
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Mine"), field("b", "Theirs")],
      revision: "rev-3",
    });
    const { edit, fields } = setup();

    edit(renamed("a", "Mine"));
    await settle();

    expect(mutateAsync).toHaveBeenLastCalledWith({
      id: "form-1",
      expectedRevision: "rev-2",
      ops: [{ op: "upsert", field: field("a", "Mine") }],
    });
    expect(fields()).toEqual([field("a", "Mine"), field("b", "Theirs")]);
    expect(findText("saveConflict.title")).toBeUndefined();
  });

  it("asks when both changed the same field, and doesn't save until answered", async () => {
    const theirs = [field("a", "Theirs"), field("b", "B")];
    mutateAsync.mockRejectedValueOnce(conflict(theirs, "rev-2"));
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Mine"), field("b", "B")],
      revision: "rev-3",
    });
    const { edit, fields } = setup();

    edit(renamed("a", "Mine"));
    await settle();

    expect(findText("saveConflict.title")).toBeTruthy();
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      clickText("saveConflict.keepMine");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mutateAsync).toHaveBeenLastCalledWith({
      id: "form-1",
      expectedRevision: "rev-2",
      ops: [{ op: "upsert", field: field("a", "Mine") }],
    });
    expect(fields()[0]?.label).toBe("Mine");
    expect(findText("saveConflict.keptMine")).toBeTruthy();
  });

  it("gets the other version back after a choice", async () => {
    const theirs = [field("a", "Theirs"), field("b", "B")];
    mutateAsync.mockRejectedValueOnce(conflict(theirs, "rev-2"));
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Mine"), field("b", "B")],
      revision: "rev-3",
    });
    mutateAsync.mockResolvedValueOnce({ fields: theirs, revision: "rev-4" });
    const { edit, fields } = setup();

    edit(renamed("a", "Mine"));
    await settle();
    await act(async () => {
      clickText("saveConflict.keepMine");
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => clickText("saveConflict.getOtherBack"));
    await settle();

    expect(fields()[0]?.label).toBe("Theirs");
    expect(mutateAsync).toHaveBeenLastCalledWith({
      id: "form-1",
      expectedRevision: "rev-3",
      ops: [{ op: "upsert", field: field("a", "Theirs") }],
    });
  });

  it("keeps an edit made while a save is on its way", async () => {
    let finishSave!: (value: unknown) => void;
    mutateAsync.mockImplementationOnce(
      () => new Promise((resolve) => (finishSave = resolve)),
    );
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Mine"), field("b", "Later")],
      revision: "rev-3",
    });
    const { edit, fields } = setup();

    edit(renamed("a", "Mine"));
    await settle();
    edit(renamed("b", "Later"));
    await act(async () => {
      finishSave({
        fields: [field("a", "Mine"), field("b", "B")],
        revision: "rev-2",
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mutateAsync).toHaveBeenLastCalledWith({
      id: "form-1",
      expectedRevision: "rev-2",
      ops: [{ op: "upsert", field: field("b", "Later") }],
    });
    expect(fields()).toEqual([field("a", "Mine"), field("b", "Later")]);
  });

  it("keeps a failed edit for the next save instead of dropping it", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("offline"));
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Mine"), field("b", "Second")],
      revision: "rev-2",
    });
    const { edit, fields } = setup();

    edit(renamed("a", "Mine"));
    await settle();
    expect(fields()[0]?.label).toBe("Mine");

    edit(renamed("b", "Second"));
    await settle();

    expect(mutateAsync).toHaveBeenLastCalledWith({
      id: "form-1",
      expectedRevision: "rev-1",
      ops: [
        { op: "upsert", field: field("a", "Mine") },
        { op: "upsert", field: field("b", "Second") },
      ],
    });
  });

  it("keeps an edit made after the choice when getting the other version back", async () => {
    const theirs = [field("a", "Theirs"), field("b", "B")];
    mutateAsync.mockRejectedValueOnce(conflict(theirs, "rev-2"));
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Mine"), field("b", "B")],
      revision: "rev-3",
    });
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Mine"), field("b", "Later")],
      revision: "rev-4",
    });
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Theirs"), field("b", "Later")],
      revision: "rev-5",
    });
    const { edit, fields } = setup();

    edit(renamed("a", "Mine"));
    await settle();
    await act(async () => {
      clickText("saveConflict.keepMine");
      await vi.advanceTimersByTimeAsync(0);
    });
    edit(renamed("b", "Later"));
    await settle();
    act(() => clickText("saveConflict.getOtherBack"));
    await settle();

    expect(fields().map((item) => item.label)).toEqual(["Theirs", "Later"]);
    expect(mutateAsync).toHaveBeenLastCalledWith({
      id: "form-1",
      expectedRevision: "rev-4",
      ops: [{ op: "upsert", field: field("a", "Theirs") }],
    });
  });

  it("tries once more when a save still out on leaving then fails", async () => {
    let failSave = (_error: Error) => {};
    mutateAsync.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failSave = reject;
        }),
    );
    mutateAsync.mockRejectedValueOnce(new Error("still offline"));
    const { edit } = setup();

    edit(renamed("a", "Mine"));
    await settle();
    act(() => root?.unmount());
    root = undefined;
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    failSave(new Error("offline"));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("tries once more when the save sent on leaving fails", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("offline"));
    mutateAsync.mockRejectedValueOnce(new Error("still offline"));
    const { edit } = setup();

    edit(renamed("a", "Mine"));
    act(() => root?.unmount());
    root = undefined;

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("saves an edit whose timer went off while a failing save was out", async () => {
    let failFirst = (_error: Error) => {};
    mutateAsync.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failFirst = reject;
        }),
    );
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Mine"), field("b", "Later")],
      revision: "rev-2",
    });
    const { edit } = setup();

    edit(renamed("a", "Mine"));
    await settle();
    edit(renamed("b", "Later"));
    await settle();
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    failFirst(new Error("offline"));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync.mock.lastCall?.[0].ops).toEqual([
      { op: "upsert", field: field("a", "Mine") },
      { op: "upsert", field: field("b", "Later") },
    ]);
  });

  it("doesn't retry a later failure because of a save that already landed", async () => {
    let landFirst = (_saved: unknown) => {};
    mutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          landFirst = resolve;
        }),
    );
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Mine"), field("b", "Later")],
      revision: "rev-3",
    });
    mutateAsync.mockRejectedValueOnce(new Error("offline"));
    const { edit } = setup();

    edit(renamed("a", "Mine"));
    await settle();
    edit(renamed("b", "Later"));
    await settle();
    landFirst({
      fields: [field("a", "Mine"), field("b", "B")],
      revision: "rev-2",
    });
    await settle();
    expect(mutateAsync).toHaveBeenCalledTimes(2);

    edit(renamed("b", "Last"));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(mutateAsync).toHaveBeenCalledTimes(3);
  });

  it("tries a failed edit once more on leaving", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("offline"));
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Mine"), field("b", "B")],
      revision: "rev-2",
    });
    const { edit } = setup();

    edit(renamed("a", "Mine"));
    await settle();
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    act(() => root?.unmount());
    root = undefined;
    await settle();
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("sends nothing on leaving once everything is saved", async () => {
    mutateAsync.mockResolvedValueOnce({
      fields: [field("a", "Mine"), field("b", "B")],
      revision: "rev-2",
    });
    const { edit } = setup();

    edit(renamed("a", "Mine"));
    await settle();

    act(() => root?.unmount());
    root = undefined;
    await settle();
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("adopts newer server fields only when nothing local is unsaved", async () => {
    mutateAsync.mockImplementation(() => new Promise(() => {}));
    const { edit, fields, rerender } = setup();

    rerender(form([field("a", "A"), field("b", "Server")], "rev-2"));
    expect(fields()[1]?.label).toBe("Server");

    edit(renamed("a", "Mine"));
    rerender(form([field("a", "A"), field("b", "Newer")], "rev-3"));

    expect(fields()).toEqual([field("a", "Mine"), field("b", "Server")]);
  });
});
