// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useSkillChoices,
  type SkillChoicesState,
} from "./use-skill-choices.js";

const mocks = vi.hoisted(() => ({
  session: "authenticated",
  answer: undefined as unknown,
  isError: false,
  answerAt: 0,
  counts: undefined as unknown,
  countsAt: 0,
  countsFailedAt: 0,
  queries: [] as Array<{ name: string; enabled: boolean | undefined }>,
  refetch: vi.fn(async () => ({ isError: false })),
  refetchCounts: vi.fn(async () => undefined),
  saveSwitch: vi.fn(async (_args: unknown): Promise<unknown> => undefined),
  saveMark: vi.fn(async (_args: unknown): Promise<unknown> => undefined),
}));

vi.mock("../use-session.js", () => ({
  useSession: () => ({ status: mocks.session }),
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: (
    name: string,
    _params: unknown,
    options: { enabled?: boolean },
  ) => {
    mocks.queries.push({ name, enabled: options.enabled });
    return name === "get-skill-choices"
      ? {
          data: mocks.answer,
          dataUpdatedAt: mocks.answerAt,
          isError: mocks.isError,
          refetch: mocks.refetch,
        }
      : {
          data: mocks.counts,
          dataUpdatedAt: mocks.countsAt,
          errorUpdatedAt: mocks.countsFailedAt,
          refetch: mocks.refetchCounts,
        };
  },
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "set-skill-switch" ? mocks.saveSwitch : mocks.saveMark,
  }),
}));

const PATH = "skills/brand-voice/SKILL.md";
const ORG = `organization:${PATH}`;

let state: SkillChoicesState;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe(props: { enabled?: boolean }) {
  state = useSkillChoices(props);
  return null;
}

async function render(props: { enabled?: boolean } = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(React.createElement(Probe, props)));
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function lastQuery(name: string) {
  return mocks.queries.filter((query) => query.name === name).at(-1);
}

beforeEach(() => {
  mocks.session = "authenticated";
  mocks.answer = {
    switches: { [ORG]: { on: true, at: 5 } },
    marks: { [ORG]: "optional" },
    canMark: false,
  };
  mocks.isError = false;
  mocks.answerAt = 0;
  mocks.counts = undefined;
  mocks.countsAt = 0;
  mocks.countsFailedAt = 0;
  mocks.queries.length = 0;
  vi.spyOn(Date, "now").mockReturnValue(1234);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("useSkillChoices", () => {
  it("shows a member's saved switches and marks, without counts", async () => {
    await render();
    expect(state.isLoaded).toBe(true);
    expect(state.isError).toBe(false);
    expect(state.canMark).toBe(false);
    expect(state.counts).toBeNull();
    expect(state.choices).toEqual({
      switches: { [ORG]: { on: true, at: 5 } },
      marks: { [ORG]: "optional" },
    });
    expect(lastQuery("get-skill-choices")?.enabled).toBe(true);
    expect(lastQuery("get-skill-choice-counts")?.enabled).toBe(false);
  });

  it("loads counts only for an admin", async () => {
    mocks.answer = { switches: {}, marks: {}, canMark: true };
    mocks.counts = { members: 3, counts: {} };
    await render();
    expect(state.canMark).toBe(true);
    expect(lastQuery("get-skill-choice-counts")?.enabled).toBe(true);
    expect(state.counts).toEqual({ members: 3, counts: {} });
  });

  it("fetches the counts again on request, for an admin only", async () => {
    await render();
    act(() => state.refreshCounts());
    expect(mocks.refetchCounts).not.toHaveBeenCalled();

    act(() => root?.unmount());
    container?.remove();
    mocks.answer = { switches: {}, marks: {}, canMark: true };
    await render();
    act(() => state.refreshCounts());
    expect(mocks.refetchCounts).toHaveBeenCalledTimes(1);
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it("says whether the counts asked for are in", async () => {
    mocks.answer = { switches: {}, marks: {}, canMark: true };
    mocks.counts = { members: 3, counts: {} };
    mocks.countsAt = 1000;
    await render();
    expect(state.countsCheck).toBe("done");

    act(() => state.refreshCounts());
    expect(state.countsCheck).toBe("checking");

    // The same page reads the query again as answers come in.
    const rerender = () =>
      act(async () => root?.render(React.createElement(Probe)));
    mocks.countsFailedAt = 1300;
    await rerender();
    expect(state.countsCheck).toBe("failed");

    mocks.countsAt = 1400;
    await rerender();
    expect(state.countsCheck).toBe("done");
  });

  it("loads nothing until someone is signed in, or when turned off", async () => {
    mocks.session = "loading";
    mocks.answer = undefined;
    await render();
    expect(lastQuery("get-skill-choices")?.enabled).toBe(false);
    expect(state.isLoaded).toBe(false);
    expect(state.choices).toEqual({ switches: {}, marks: {} });

    act(() => root?.unmount());
    container?.remove();
    mocks.session = "authenticated";
    await render({ enabled: false });
    expect(lastQuery("get-skill-choices")?.enabled).toBe(false);
    expect(lastQuery("get-skill-choice-counts")?.enabled).toBe(false);
  });

  it("reports a failed load", async () => {
    mocks.isError = true;
    await render();
    expect(state.isError).toBe(true);
  });

  it("shows a switch at once and keeps it until the saved answer is back", async () => {
    const save = deferred();
    mocks.saveSwitch.mockImplementationOnce(async () => save.promise);
    await render();

    let done!: Promise<void>;
    act(() => {
      done = state.setSwitch("organization", PATH, false);
    });
    expect(mocks.saveSwitch).toHaveBeenCalledWith({
      source: "organization",
      path: PATH,
      on: false,
    });
    expect(state.choices.switches[ORG]).toEqual({ on: false, at: 1234 });
    expect(mocks.refetch).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve();
      await done;
    });
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.refetchCounts).not.toHaveBeenCalled();
    expect(state.choices.switches[ORG]).toEqual({ on: true, at: 5 });
  });

  it("refreshes an admin's counts after their own switch", async () => {
    mocks.answer = { switches: {}, marks: {}, canMark: true };
    await render();
    await act(async () => {
      await state.setSwitch("workspace", PATH, false);
    });
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.refetchCounts).toHaveBeenCalledTimes(1);
  });

  it("puts a switch back when the server refuses it", async () => {
    mocks.saveSwitch.mockRejectedValueOnce(new Error("Forbidden"));
    await render();
    let failure: unknown;
    await act(async () => {
      await state.setSwitch("organization", PATH, false).catch((error) => {
        failure = error;
      });
    });
    expect(failure).toEqual(new Error("Forbidden"));
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(state.choices.switches[ORG]).toEqual({ on: true, at: 5 });
  });

  it("keeps a saved switch when the read after it fails, until a read succeeds", async () => {
    mocks.refetch.mockResolvedValueOnce({ isError: true });
    await render();
    await act(async () => {
      await state.setSwitch("organization", PATH, false);
    });
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(state.choices.switches[ORG]).toEqual({ on: false, at: 1234 });

    mocks.answer = {
      switches: { [ORG]: { on: false, at: 1300 } },
      marks: {},
      canMark: false,
    };
    mocks.answerAt = 1400;
    await act(async () => root?.render(React.createElement(Probe)));
    expect(state.choices.switches[ORG]).toEqual({ on: false, at: 1300 });
  });

  it("keeps the latest of two quick switches until its own save is back", async () => {
    const first = deferred();
    const second = deferred();
    mocks.saveSwitch
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);
    await render();

    let one!: Promise<void>;
    let two!: Promise<void>;
    act(() => {
      one = state.setSwitch("organization", PATH, false);
    });
    act(() => {
      two = state.setSwitch("organization", PATH, true);
    });
    await act(async () => {
      first.resolve();
      await one;
    });
    expect(state.choices.switches[ORG]).toEqual({ on: true, at: 1234 });

    await act(async () => {
      second.resolve();
      await two;
    });
    expect(state.choices.switches[ORG]).toEqual({ on: true, at: 5 });
  });

  it("saves quick switches to one skill in order, even after a refusal", async () => {
    const first = deferred();
    const second = deferred();
    mocks.saveSwitch
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);
    await render();

    let one!: Promise<void>;
    let two!: Promise<void>;
    let three!: Promise<void>;
    act(() => {
      one = state.setSwitch("organization", PATH, false);
    });
    act(() => {
      two = state.setSwitch("organization", PATH, true);
    });
    // The second waits for the first, so the server stores the last one.
    expect(mocks.saveSwitch).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.reject(new Error("Forbidden"));
      await one.catch(() => undefined);
    });
    await vi.waitFor(() => expect(mocks.saveSwitch).toHaveBeenCalledTimes(2));
    act(() => {
      three = state.setSwitch("organization", PATH, false);
    });
    expect(mocks.saveSwitch).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve();
      await two;
      await three;
    });
    expect(
      mocks.saveSwitch.mock.calls.map(([args]) => (args as { on: boolean }).on),
    ).toEqual([false, true, false]);

    // With nothing left saving, the next switch saves at once.
    act(() => {
      void state.setSwitch("organization", PATH, true);
    });
    expect(mocks.saveSwitch).toHaveBeenCalledTimes(4);
  });

  it("keeps a switch and a mark on one skill apart", async () => {
    const switchSave = deferred();
    const markSave = deferred();
    mocks.saveSwitch.mockImplementationOnce(async () => switchSave.promise);
    mocks.saveMark.mockImplementationOnce(async () => markSave.promise);
    await render();

    let flip!: Promise<void>;
    let mark!: Promise<void>;
    act(() => {
      flip = state.setSwitch("organization", PATH, false);
    });
    act(() => {
      mark = state.setMark("organization", PATH, "required");
    });
    expect(mocks.saveMark).toHaveBeenCalledTimes(1);

    await act(async () => {
      switchSave.resolve();
      await flip;
    });
    // The switch's own save is back, whatever the mark is doing.
    expect(state.choices.switches[ORG]).toEqual({ on: true, at: 5 });
    expect(state.choices.marks[ORG]).toBe("required");

    await act(async () => {
      markSave.resolve();
      await mark;
    });
    expect(state.choices.marks[ORG]).toBe("optional");
  });

  it("shows a mark at once, and Recommended as no mark", async () => {
    const save = deferred();
    mocks.saveMark.mockImplementationOnce(async () => save.promise);
    await render();

    let done!: Promise<void>;
    act(() => {
      done = state.setMark("organization", PATH, "recommended");
    });
    expect(mocks.saveMark).toHaveBeenCalledWith({
      source: "organization",
      path: PATH,
      mark: "recommended",
    });
    expect(state.choices.marks).toEqual({});

    await act(async () => {
      save.resolve();
      await done;
    });
    expect(state.choices.marks).toEqual({ [ORG]: "optional" });

    act(() => {
      done = state.setMark("workspace", PATH, "required");
    });
    expect(state.choices.marks).toEqual({
      [ORG]: "optional",
      [`workspace:${PATH}`]: "required",
    });
    await act(async () => {
      await done;
    });
  });
});
