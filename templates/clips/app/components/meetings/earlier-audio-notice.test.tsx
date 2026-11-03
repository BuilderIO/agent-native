// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
}));

import {
  EarlierAudioNotice,
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
    minutes: number;
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

  it("offers Remove only to someone who can edit", async () => {
    await render({ minutes: 5, canRemove: false });
    expect(host.textContent).toContain("meetingDetail.earlierAudioAdded:5");
    expect(buttonNamed("meetingDetail.remove")).toEqual([]);
  });

  it("asks before removing", async () => {
    const onRemove = vi.fn();
    await render({ minutes: 5, onRemove });

    await act(async () => buttonNamed("meetingDetail.remove")[0].click());
    expect(onRemove).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "meetingDetail.removeEarlierAudioTitle",
    );

    const [, confirm] = buttonNamed("meetingDetail.remove");
    await act(async () => confirm.click());
    expect(onRemove).toHaveBeenCalledOnce();
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
