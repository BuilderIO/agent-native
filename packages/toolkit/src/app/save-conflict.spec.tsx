// @vitest-environment happy-dom

import {
  SaveOverlapError,
  type SaveOverlap,
} from "@agent-native/core/save-conflict";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSaveConflictPrompt } from "./save-conflict.js";

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));
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
  let resolveOverlap!: (next: SaveOverlap<Draft>) => Promise<Draft>;
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
  return { view, onRestore, ask: (next = overlap) => resolveOverlap(next) };
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
    act(() => screen.getByText("saveConflict.keepMine").click());
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
    act(() => screen.getByText("saveConflict.useTheirs").click());
    await expect(choice).resolves.toEqual(overlap.useTheirs);
    act(() => screen.getByText("saveConflict.getOtherBack").click());
    expect(onRestore).toHaveBeenCalledWith(overlap.keepMine);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("counts each prompt, each choice and each restore", async () => {
    const { ask } = setup();
    act(() => {
      void ask();
    });
    act(() => screen.getByText("saveConflict.keepMine").click());
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
    act(() => screen.getByText("saveConflict.keepMine").click());
    await expect(first).resolves.toEqual(overlap.keepMine);
    expect(
      screen.getByText('saveConflict.changedByBoth {"fields":"body"}'),
    ).toBeTruthy();
    act(() => screen.getByText("saveConflict.useTheirs").click());
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
  });
});
