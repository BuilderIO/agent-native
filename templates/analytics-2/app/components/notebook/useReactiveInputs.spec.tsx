// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";

import type { Cell } from "@/lib/model/contracts";

import { InputCellControl, type InputCellContents } from "./InputCellControl";
import { useCellDrafts } from "./useCellDrafts";
import { useReactiveInputs } from "./useReactiveInputs";

let host: HTMLDivElement;
let root: Root;
let flush: ((suppressReactiveRun?: boolean) => Promise<boolean>) | undefined;
const save = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  save.mockReset().mockResolvedValue("revision-2");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flush = undefined;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(inputType: InputCellContents["inputType"], initial: string) {
  const cell = {
    id: "input",
    projectId: "project",
    versionId: "draft",
    createdAt: "revision-1",
    updatedAt: "revision-1",
    contents: {
      id: "input",
      kind: "input",
      order: "a0",
      name: "region",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      inputType,
      defaultValueString: initial,
      options: ["North", "South"],
    },
  } satisfies Cell;
  function Control() {
    const drafts = useCellDrafts({ cells: [cell], onSaveCell: save });
    const inputs = useReactiveInputs({ drafts });
    flush = (suppressReactiveRun) =>
      inputs.flush(() => true, suppressReactiveRun);
    return (
      <InputCellControl
        contents={cell.contents}
        value={drafts.textFor(cell)}
        disabled={false}
        onChange={(value) => inputs.change(cell, value)}
        onCommit={(value, resultId) =>
          void inputs.commit(cell, value, resultId)
        }
      />
    );
  }
  act(() => root.render(<Control />));
}

function setValue(element: HTMLInputElement, value: string) {
  const { set } =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") ?? {};
  assert(set);
  act(() => {
    set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function selectOption(label: string) {
  const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]');
  assert(trigger);
  act(() => trigger.click());
  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((entry) => entry.textContent === label);
  assert(option);
  act(() => option.click());
}

async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

function heldSave() {
  let resolve = (_revision: string) => {};
  const promise = new Promise<string>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

it.each([
  { type: "NUMERIC_INPUT", first: "15", final: "16", delay: 250 },
  { type: "TEXT_INPUT", first: "South", final: "East", delay: 2000 },
] as const)(
  "commits $type at $delay ms after the last change",
  async ({ type, first, final, delay }) => {
    mount(type, type === "NUMERIC_INPUT" ? "0" : "");
    const input = host.querySelector("input");
    assert(input);
    setValue(input, first);
    await advance(delay - 1);
    expect(input.value).toBe(first);
    expect(save).not.toHaveBeenCalled();
    setValue(input, final);
    await advance(delay - 1);
    expect(save).not.toHaveBeenCalled();
    await advance(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(
      "input",
      expect.objectContaining({ defaultValueString: final }),
      "revision-1",
    );
    await advance(delay);
    expect(save).toHaveBeenCalledTimes(1);
  },
);

it("flushes on blur and drops a pending edit reverted to the confirmed value", async () => {
  mount("TEXT_INPUT", "North");
  const input = host.querySelector("input");
  assert(input);
  setValue(input, "South");
  setValue(input, "North");
  await advance(2000);
  expect(save).not.toHaveBeenCalled();
  setValue(input, "West");
  await act(async () =>
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
  );
  expect(save).toHaveBeenCalledExactlyOnceWith(
    "input",
    expect.objectContaining({ defaultValueString: "West" }),
    "revision-1",
  );
  await advance(2000);
  expect(save).toHaveBeenCalledTimes(1);
});

it("commits a dropdown selection without waiting for a timer", async () => {
  mount("DROPDOWN", "North");
  selectOption("South");
  await act(async () => {});
  expect(save).toHaveBeenCalledExactlyOnceWith(
    "input",
    expect.objectContaining({ defaultValueString: "South" }),
    "revision-1",
  );
});

it("flushes a pending edit for Run All without starting a second reactive run", async () => {
  mount("NUMERIC_INPUT", "0");
  const input = host.querySelector("input");
  assert(input && flush);
  setValue(input, "12");
  await act(async () => expect(await flush?.(true)).toBe(true));
  await advance(250);
  expect(save).toHaveBeenCalledExactlyOnceWith(
    "input",
    expect.objectContaining({ defaultValueString: "12" }),
    "revision-1",
    undefined,
    true,
  );
});

it("waits for successive committed selections before admitting a manual run", async () => {
  const first = heldSave();
  const next = heldSave();
  save.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
  mount("DROPDOWN", "North");
  assert(flush);
  selectOption("South");
  selectOption("North");
  const finished = vi.fn();
  const barrier = flush().then(finished);
  await act(async () => first.resolve("revision-2"));
  expect(save).toHaveBeenLastCalledWith(
    "input",
    expect.objectContaining({ defaultValueString: "North" }),
    "revision-2",
  );
  expect(finished).not.toHaveBeenCalled();
  await act(async () => {
    next.resolve("revision-3");
    await barrier;
  });
  expect(finished).toHaveBeenCalledExactlyOnceWith(true);
});

it("waits for slider release even if an explicit run flushes input edits during a drag", async () => {
  mount("SLIDER", "2");
  const slider = host.querySelector<HTMLInputElement>('input[type="range"]');
  assert(slider && flush);
  setValue(slider, "4");
  await advance(2100);
  await act(async () => expect(await flush?.()).toBe(true));
  expect(save).not.toHaveBeenCalled();
  setValue(slider, "7");
  await act(async () =>
    slider.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })),
  );
  expect(save).toHaveBeenCalledExactlyOnceWith(
    "input",
    expect.objectContaining({ defaultValueString: "7" }),
    "revision-1",
  );
});
