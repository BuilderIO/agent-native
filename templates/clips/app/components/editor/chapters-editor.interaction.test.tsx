// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Chapter, ChaptersEditor } from "./chapters-editor";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutateAsync: mocks.save }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, info: vi.fn() },
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: () => null,
}));

const intro: Chapter = { startMs: 0, title: "Intro" };
const demo: Chapter = { startMs: 48_000, title: "Demo" };

let container: HTMLDivElement;
let root: Root;
const queryClient = new QueryClient();

function render(chapters: Chapter[]) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ChaptersEditor recordingId="rec_1" chapters={chapters} currentMs={0} />
      </QueryClientProvider>,
    );
  });
}

const titles = () =>
  [...container.querySelectorAll("input")].map((i) => i.value);

const input = (index: number) => container.querySelectorAll("input")[index];

function focus(index: number) {
  act(() => {
    input(index).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
}

function leave(index: number) {
  act(() => {
    input(index).dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

/** Types into a title box without leaving it. */
function key(index: number, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setValue.call(input(index), value);
    input(index).dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Types a title and leaves the box, which saves it. */
function type(index: number, value: string) {
  focus(index);
  key(index, value);
  leave(index);
}

/** Runs the debounce and lets queued saves settle. */
async function settle(ms = 300) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const refusal = (chapters: Chapter[]) =>
  Object.assign(new Error("changed"), {
    errorCode: "chapters_changed",
    details: { chapters, cuts: [] },
  });

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.save.mockReset();
  mocks.toastError.mockReset();
  mocks.save.mockImplementation(async (vars: any) => ({
    id: "rec_1",
    chapters: vars.chapters.map((c: Chapter) => ({
      ...c,
      title: c.title.trim(),
    })),
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ChaptersEditor saves", () => {
  it("checks a save against the stored list", async () => {
    render([intro, demo]);
    type(0, "Opening");
    await settle();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      chapters: [{ ...intro, title: "Opening" }, demo],
      expectedChapters: [intro, demo],
    });
  });

  it("checks a queued save against the list the save before it stored", async () => {
    const first = deferred<unknown>();
    mocks.save.mockImplementationOnce(() => first.promise);
    render([intro]);
    type(0, "Opening");
    await settle();
    type(0, "Opening part");
    await settle();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve({ chapters: [{ ...intro, title: "Opening" }] });
    });
    await settle(0);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0].expectedChapters).toEqual([
      { ...intro, title: "Opening" },
    ]);
  });

  it("ignores chapters refetched while an edit waits, and keeps the typing", async () => {
    render([intro]);
    type(0, "Opening");
    render([{ ...intro, title: "From elsewhere" }]);
    expect(titles()).toEqual(["Opening"]);
    await settle();
    expect(mocks.save.mock.calls[0][0].expectedChapters).toEqual([intro]);
  });

  it("shows the latest list on a refusal and drops the save queued behind it", async () => {
    const first = deferred<unknown>();
    mocks.save.mockImplementationOnce(() => first.promise);
    render([intro]);
    type(0, "Opening");
    await settle();
    type(0, "Opening part");
    await settle();
    await act(async () => {
      first.reject(refusal([demo]));
    });
    await settle(0);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(titles()).toEqual(["Demo"]);
    expect(mocks.toastError).toHaveBeenCalledWith("chapters.changedElsewhere");
  });

  it("saves the next edit against the list a refusal returned", async () => {
    mocks.save.mockRejectedValueOnce(refusal([demo]));
    render([intro]);
    type(0, "Opening");
    await settle();
    type(0, "Demo two");
    await settle();
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0].expectedChapters).toEqual([demo]);
  });

  it("rolls back to the stored list when a save fails", async () => {
    mocks.save.mockRejectedValueOnce(new Error("network"));
    render([intro]);
    type(0, "Opening");
    await settle();
    expect(titles()).toEqual(["Intro"]);
    expect(mocks.toastError).toHaveBeenCalledWith("chapters.saveFailed");
  });

  it("still saves a newer edit after a save fails for another reason", async () => {
    const first = deferred<unknown>();
    mocks.save.mockImplementationOnce(() => first.promise);
    render([intro]);
    type(0, "Opening");
    await settle();
    type(0, "Opening part");
    await settle();
    await act(async () => {
      first.reject(new Error("network"));
    });
    await settle(0);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0]).toMatchObject({
      chapters: [{ ...intro, title: "Opening part" }],
      expectedChapters: [intro],
    });
    expect(titles()).toEqual(["Opening part"]);
  });

  it("still saves a waiting edit when another title is cleared", async () => {
    render([intro, demo]);
    type(0, "Opening");
    type(1, "");
    await settle();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].chapters).toEqual([
      { ...intro, title: "Opening" },
      demo,
    ]);
    expect(titles()).toEqual(["Opening", "Demo"]);
  });

  it("saves a title only when the box is left, never part-typed", async () => {
    render([intro]);
    focus(0);
    key(0, "Intr");
    await settle();
    key(0, "I");
    await settle();
    key(0, "");
    await settle();
    expect(mocks.save).not.toHaveBeenCalled();
    leave(0);
    await settle();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(titles()).toEqual(["Intro"]);
  });

  it("puts the title back on Escape", async () => {
    render([intro]);
    focus(0);
    key(0, "Nope");
    act(() => {
      input(0).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    leave(0);
    await settle();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(titles()).toEqual(["Intro"]);
  });

  it("doesn't save over a title changed elsewhere while the box was edited", async () => {
    render([intro]);
    focus(0);
    key(0, "Mine");
    render([{ ...intro, title: "Theirs" }]);
    // Shown at once, so the row shows the chapter a delete would remove.
    expect(titles()).toEqual(["Theirs"]);
    expect(mocks.toastError).toHaveBeenCalledWith("chapters.changedElsewhere");
    leave(0);
    await settle();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(titles()).toEqual(["Theirs"]);
  });

  it("keeps typing in a row when a chapter is added above it elsewhere", async () => {
    const setup = { startMs: 10_000, title: "Setup" };
    render([intro, demo]);
    focus(1);
    key(1, "Product demo");
    render([intro, setup, demo]);
    expect(titles()).toEqual(["Intro", "Setup", "Product demo"]);
    // Still being edited: the same box, nothing saved yet.
    await settle();
    expect(mocks.save).not.toHaveBeenCalled();
    leave(2);
    await settle();
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      chapters: [intro, setup, { ...demo, title: "Product demo" }],
      expectedChapters: [intro, setup, demo],
    });
  });

  it("says so when a row being edited was removed elsewhere", async () => {
    render([intro, demo]);
    focus(1);
    key(1, "Product demo");
    render([intro]);
    await settle();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("chapters.changedElsewhere");
  });

  it("doesn't delete a chapter that took a row's place before the screen caught up", async () => {
    const pricing = { startMs: 48_000, title: "Pricing" };
    mocks.save.mockRejectedValueOnce(refusal([intro, pricing]));
    render([intro, demo]);
    type(0, "Opening");
    const demoRow = input(1).closest(".group")!;
    const buttons = demoRow.querySelectorAll("button");
    const trash = buttons[buttons.length - 1];
    mocks.toastError.mockImplementationOnce(() => trash.click());
    await settle();
    await settle();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(titles()).toEqual(["Intro", "Pricing"]);
  });

  it("doesn't delete a title that arrived between pressing and releasing delete", async () => {
    render([intro, demo]);
    const trash = () => {
      const buttons = input(1).closest(".group")!.querySelectorAll("button");
      return buttons[buttons.length - 1];
    };
    act(() => {
      trash().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    render([intro, { ...demo, title: "Pricing deep-dive" }]);
    act(() => trash().click());
    await settle();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(titles()).toEqual(["Intro", "Pricing deep-dive"]);
    expect(mocks.toastError).toHaveBeenCalledWith("chapters.changedElsewhere");
  });

  it("saves the title being typed when the panel closes", async () => {
    render([intro]);
    focus(0);
    key(0, "Opening");
    act(() => root.unmount());
    await settle();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].chapters).toEqual([
      { ...intro, title: "Opening" },
    ]);
    root = createRoot(container);
  });

  it("doesn't save an edit made on a list a refusal just replaced", async () => {
    mocks.save.mockRejectedValueOnce(refusal([intro, demo]));
    render([intro]);
    type(0, "Opening");
    focus(0);
    key(0, "Opening two");
    await settle();
    leave(0);
    await settle();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(titles()).toEqual(["Intro", "Demo"]);
  });

  it("saves the last edit when the panel closes mid-pause", async () => {
    render([intro]);
    type(0, "Opening");
    act(() => root.unmount());
    await settle(0);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].chapters).toEqual([
      { ...intro, title: "Opening" },
    ]);
    root = createRoot(container);
  });

  it("treats a reply without chapters as a failed save", async () => {
    mocks.save.mockResolvedValueOnce({ id: "rec_1" });
    render([intro]);
    type(0, "Opening");
    await settle();
    expect(mocks.toastError).toHaveBeenCalledWith("chapters.saveFailed");
    type(0, "Opening two");
    await settle();
    expect(mocks.save.mock.calls[1][0].expectedChapters).toEqual([intro]);
  });

  it("sends edits made during a save as one save of the newest list", async () => {
    const first = deferred<unknown>();
    mocks.save.mockImplementationOnce(() => first.promise);
    render([intro]);
    type(0, "A");
    await settle();
    type(0, "AB");
    await settle();
    type(0, "ABC");
    await settle();
    await act(async () => {
      first.resolve({ chapters: [{ ...intro, title: "A" }] });
    });
    await settle(0);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0].chapters).toEqual([
      { ...intro, title: "ABC" },
    ]);
  });

  it("retries once when the server was too busy to check", async () => {
    mocks.save.mockRejectedValueOnce(
      Object.assign(new Error("busy"), { errorCode: "chapters_busy" }),
    );
    render([intro]);
    type(0, "Opening");
    await settle();
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(titles()).toEqual(["Opening"]);
  });

  it("keeps a trailing space when its own save comes back trimmed", async () => {
    render([intro]);
    type(0, "Intro ");
    await settle();
    render([intro]);
    expect(titles()).toEqual(["Intro "]);
  });

  it("takes a change made elsewhere while idle, and checks the next save against it", async () => {
    render([intro]);
    render([demo]);
    expect(titles()).toEqual(["Demo"]);
    type(0, "Demo two");
    await settle();
    expect(mocks.save.mock.calls[0][0].expectedChapters).toEqual([demo]);
  });
});
