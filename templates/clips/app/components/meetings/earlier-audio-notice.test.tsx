// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
}));

import {
  DEFERRED_NOTES_POLL_MS,
  DEFERRED_NOTES_WAIT_MS,
  EarlierAudioNotice,
  useDeferredNotesWait,
  withEarlierAudioRemoved,
} from "./earlier-audio-notice";

describe("EarlierAudioNotice", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  const render = (props: {
    minutes: number | null;
    canRemove?: boolean;
    onRemove?: () => void;
  }) =>
    act(async () => {
      root.render(
        <EarlierAudioNotice canRemove onRemove={() => {}} {...props} />,
      );
    });

  const buttonNamed = (name: string) =>
    [...document.querySelectorAll("button")].filter(
      (button) => button.textContent === name,
    );

  it("shows the recovered minutes", async () => {
    await render({ minutes: 5 });
    expect(host.textContent).toContain("meetingDetail.earlierAudioAdded:5");
  });

  it("shows nothing without earlier audio", async () => {
    await render({ minutes: 0 });
    expect(host.innerHTML).toBe("");
  });

  it("says when the transcript can't be read, with nothing to remove", async () => {
    await render({ minutes: null });
    expect(host.textContent).toContain("meetingDetail.earlierAudioUnreadable");
    expect(buttonNamed("meetingDetail.remove")).toEqual([]);
  });

  it("offers Remove only to someone who can edit", async () => {
    await render({ minutes: 5, canRemove: false });
    expect(host.textContent).toContain("meetingDetail.earlierAudioAdded:5");
    expect(buttonNamed("meetingDetail.remove")).toEqual([]);
  });

  it("asks before removing", async () => {
    const onRemove = vi.fn();
    await render({ minutes: 5, onRemove });

    await act(async () => buttonNamed("meetingDetail.remove")[0]?.click());
    expect(onRemove).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "meetingDetail.removeEarlierAudioTitle",
    );

    await act(async () => buttonNamed("meetingDetail.remove")[1]?.click());
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe("useDeferredNotesWait", () => {
  let root: Root;
  let wait: ReturnType<typeof useDeferredNotesWait>;
  const refetch = vi.fn();
  const onGiveUp = vi.fn();

  function Harness(props: {
    meetingId: string;
    notesArrived: boolean;
    notesFailed?: boolean;
  }) {
    wait = useDeferredNotesWait({ ...props, refetch, onGiveUp });
    return null;
  }
  const render = (
    notesArrived = false,
    meetingId = "m1",
    notesFailed = false,
  ) =>
    act(async () => {
      root.render(
        <Harness
          meetingId={meetingId}
          notesArrived={notesArrived}
          notesFailed={notesFailed}
        />,
      );
    });
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const start = () => act(async () => wait.start("m1"));

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    refetch.mockClear();
    onGiveUp.mockClear();
    root = createRoot(document.createElement("div"));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does nothing until a removal leaves its rebuild to the job", async () => {
    await render();
    await advance(DEFERRED_NOTES_WAIT_MS);

    expect(wait.pending).toBe(false);
    expect(refetch).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("refetches until the rebuilt notes arrive, then stops", async () => {
    await render();
    await start();
    expect(wait.pending).toBe(true);

    await advance(DEFERRED_NOTES_POLL_MS * 2);
    expect(refetch).toHaveBeenCalledTimes(2);

    await render(true);
    expect(wait.pending).toBe(false);
    await advance(DEFERRED_NOTES_WAIT_MS);
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("gives up visibly when the notes never arrive", async () => {
    await render();
    await start();

    await advance(DEFERRED_NOTES_WAIT_MS);
    expect(wait.pending).toBe(false);
    expect(onGiveUp).toHaveBeenCalledTimes(1);

    refetch.mockClear();
    await advance(DEFERRED_NOTES_WAIT_MS);
    expect(refetch).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("keeps watching when a poll re-renders the page", async () => {
    await render();
    await start();

    await advance(DEFERRED_NOTES_WAIT_MS - 1_000);
    await render();
    await advance(1_000);

    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("says so as soon as the run it waits on fails", async () => {
    await render();
    await start();
    await advance(DEFERRED_NOTES_POLL_MS);

    await render(true, "m1", true);
    expect(wait.pending).toBe(false);
    expect(onGiveUp).toHaveBeenCalledTimes(1);

    refetch.mockClear();
    await advance(DEFERRED_NOTES_WAIT_MS);
    expect(refetch).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("reports each failed run it waits on", async () => {
    await render();
    await start();
    await render(true, "m1", true);
    expect(onGiveUp).toHaveBeenCalledTimes(1);

    await render();
    await start();
    await render(true, "m1", true);
    expect(onGiveUp).toHaveBeenCalledTimes(2);
  });

  it("ignores a failure from before the wait started", async () => {
    await render(true, "m1", true);
    await advance(DEFERRED_NOTES_WAIT_MS);

    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("doesn't carry a wait over to another meeting", async () => {
    await render();
    await start();

    await render(false, "m2");
    expect(wait.pending).toBe(false);
    await advance(DEFERRED_NOTES_WAIT_MS);
    expect(refetch).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });
});

describe("withEarlierAudioRemoved", () => {
  const segments = JSON.stringify([
    { startMs: 0, endMs: 1, text: "earlier", recovered: true },
    { startMs: 1, endMs: 2, text: "live" },
  ]);

  it("hides the notice, the audio and the notes of an ended meeting", () => {
    const result = withEarlierAudioRemoved({
      earlierAudioMinutes: 5,
      actionItems: [{ text: "from the earlier audio" }],
      transcript: { segmentsJson: segments },
      meeting: {
        actualEnd: "2026-11-03T10:00:00.000Z",
        summaryMd: "summary",
        userNotesMd: "mine",
      },
    });

    expect(result.earlierAudioMinutes).toBe(0);
    expect(result.actionItems).toEqual([]);
    expect(JSON.parse(result.transcript.segmentsJson)).toEqual([
      { startMs: 1, endMs: 2, text: "live" },
    ]);
    expect(result.meeting).toMatchObject({
      summaryMd: "",
      bulletsJson: "[]",
      userNotesMd: "mine",
    });
  });

  it("keeps the notes of a meeting still running", () => {
    const result = withEarlierAudioRemoved({
      earlierAudioMinutes: 5,
      actionItems: [{ text: "added by hand" }],
      transcript: { segmentsJson: segments },
      meeting: { actualEnd: null, summaryMd: "typed live" },
    });

    expect(result.actionItems).toEqual([{ text: "added by hand" }]);
    expect(result.meeting).toMatchObject({ summaryMd: "typed live" });
  });
});
