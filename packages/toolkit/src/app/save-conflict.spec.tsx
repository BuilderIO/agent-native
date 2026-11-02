// @vitest-environment happy-dom

import {
  SaveOverlapError,
  type SaveOverlap,
} from "@agent-native/core/save-conflict";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSaveConflictPrompt } from "./save-conflict.js";

const { trackEvent, toastError } = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

type Draft = { subject: string; body: string };

const overlap: SaveOverlap<Draft> = {
  fields: ["subject"],
  base: { subject: "base", body: "base" },
  mine: { subject: "mine", body: "base" },
  theirs: { subject: "theirs", body: "new" },
  keepMine: { subject: "mine", body: "new" },
  useTheirs: { subject: "theirs", body: "new" },
};

function setup(onRestore = vi.fn()) {
  let resolveOverlap!: (
    next: SaveOverlap<Draft>,
    finished: Promise<void>,
  ) => Promise<Draft>;
  function Host() {
    const conflict = useSaveConflictPrompt<Draft>({
      record: "draft",
      describeField: (path) => path,
      onRestore,
    });
    resolveOverlap = conflict.resolveOverlap;
    return conflict.prompt;
  }
  const view = render(<Host />);
  return {
    view,
    onRestore,
    ask: (next = overlap, finished = Promise.resolve()) =>
      resolveOverlap(next, finished),
  };
}

/** Clicks a choice and lets a save that's already over bring up the notice. */
async function choose(label: string) {
  await act(async () => {
    screen.getByText(label).click();
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSaveConflictPrompt", () => {
  it("shows nothing until there's a choice to make", () => {
    setup();
    expect(screen.queryByText("saveConflict.title")).toBeNull();
  });

  it("names the fields and resolves with my merged version", async () => {
    const { ask } = setup();
    let choice!: Promise<Draft>;
    act(() => {
      choice = ask();
    });
    expect(screen.getByText("saveConflict.title")).toBeTruthy();
    expect(
      screen.getByText('saveConflict.changedByBoth {"fields":"subject"}'),
    ).toBeTruthy();
    await choose("saveConflict.keepMine");
    await expect(choice).resolves.toEqual(overlap.keepMine);
    expect(screen.queryByText("saveConflict.title")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "saveConflict.keptMine",
    );
  });

  it("offers the other version back after either choice", async () => {
    const { ask, onRestore } = setup();
    let choice!: Promise<Draft>;
    act(() => {
      choice = ask();
    });
    await choose("saveConflict.useTheirs");
    await expect(choice).resolves.toEqual(overlap.useTheirs);
    act(() => screen.getByText("saveConflict.getOtherBack").click());
    expect(onRestore).toHaveBeenCalledWith(overlap.keepMine);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("holds the other version back until the chosen save is over", async () => {
    const { ask, onRestore } = setup();
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    act(() => {
      void ask(overlap, finished);
    });
    await choose("saveConflict.useTheirs");
    expect(screen.queryByText("saveConflict.getOtherBack")).toBeNull();

    await act(async () => {
      finish();
      await finished;
    });
    act(() => screen.getByText("saveConflict.getOtherBack").click());
    expect(onRestore).toHaveBeenCalledWith(overlap.keepMine);
  });

  it("takes down an earlier notice when a new choice is made", async () => {
    const { ask } = setup();
    act(() => {
      void ask();
    });
    await choose("saveConflict.keepMine");
    expect(screen.getByText("saveConflict.getOtherBack")).toBeTruthy();

    act(() => {
      void ask(overlap, new Promise<void>(() => {}));
    });
    await choose("saveConflict.keepMine");
    expect(screen.queryByText("saveConflict.getOtherBack")).toBeNull();
  });

  it("counts each prompt, each choice and each restore", async () => {
    const { ask } = setup();
    act(() => {
      void ask();
    });
    await choose("saveConflict.keepMine");
    act(() => screen.getByText("saveConflict.getOtherBack").click());
    expect(trackEvent.mock.calls).toEqual([
      [
        "save_conflict_prompt",
        { record: "draft", outcome: "shown", field_count: 1 },
      ],
      [
        "save_conflict_prompt",
        { record: "draft", outcome: "keep_mine", field_count: 1 },
      ],
      ["save_conflict_prompt", { record: "draft", outcome: "restored" }],
    ]);
  });

  it("asks about two overlaps one at a time", async () => {
    const { ask } = setup();
    const second = { ...overlap, fields: ["body"] };
    let first!: Promise<Draft>;
    let next!: Promise<Draft>;
    act(() => {
      first = ask();
      next = ask(second);
    });
    await choose("saveConflict.keepMine");
    await expect(first).resolves.toEqual(overlap.keepMine);
    expect(
      screen.getByText('saveConflict.changedByBoth {"fields":"body"}'),
    ).toBeTruthy();
    await choose("saveConflict.useTheirs");
    await expect(next).resolves.toEqual(overlap.useTheirs);
  });

  it("fails a waiting save when the prompt goes away", async () => {
    const { ask, view } = setup();
    let choice!: Promise<Draft>;
    act(() => {
      choice = ask();
    });
    view.unmount();
    await expect(choice).rejects.toBeInstanceOf(SaveOverlapError);
    expect(toastError).toHaveBeenCalledWith("saveConflict.notSaved");
  });

  it("fails an overlap that arrives after the prompt went away", async () => {
    const { ask, view } = setup();
    view.unmount();
    await expect(ask()).rejects.toBeInstanceOf(SaveOverlapError);
    expect(toastError).toHaveBeenCalledWith("saveConflict.notSaved");
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("doesn't say a choice already made went unsaved", async () => {
    const { ask, view } = setup();
    let choice!: Promise<Draft>;
    act(() => {
      choice = ask();
    });
    fireEvent.click(screen.getByText("saveConflict.keepMine"));
    await choice;
    view.unmount();
    expect(toastError).not.toHaveBeenCalled();
  });
});
