// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import {
  BEGIN_TEXT_EDIT_ACTIVATION_CONFIRM_DELAY_MS,
  BEGIN_TEXT_EDIT_RETRY_DELAYS_MS,
  PENDING_TEXT_EDIT_TIMEOUT_MS,
  TEXT_EDIT_STATUS_PROBE_TIMEOUT_MS,
} from "@/components/design/design-canvas/pending-text-edit";

import {
  endedTextEditClosesActiveSession,
  endedTextEditMatchesPendingCreation,
  scheduleBeginTextEditForScreen,
} from "./text-edit-utils";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it.each([false, true])(
  "only an explicit edit reopens committed text (reopenExisting=%s)",
  async (reopenExisting) => {
    vi.useFakeTimers();
    const board = document.createElement("div");
    board.dataset.boardSurfaceLayer = "";
    const iframe = document.createElement("iframe");
    iframe.dataset.designPreviewIframe = "";
    board.append(iframe);
    document.body.append(board);
    const win = iframe.contentWindow!;
    const post = vi.spyOn(win, "postMessage").mockImplementation((message) => {
      if (message.type !== "agent-native:text-edit-status") return;
      window.dispatchEvent(
        new MessageEvent("message", {
          source: win,
          data: {
            type: "agent-native:text-edit-status-result",
            correlationId: message.correlationId,
            status: "done",
          },
        }),
      );
    });
    const onExhausted = vi.fn();
    scheduleBeginTextEditForScreen("screen", "text", {
      boardFileId: "screen",
      reopenExisting,
      onExhausted,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      post.mock.calls.filter(([message]) => message.type === "begin-text-edit"),
    ).toHaveLength(reopenExisting ? 1 : 0);
    expect(onExhausted).toHaveBeenCalledExactlyOnceWith("done");
  },
);

it("cancels a pending creation only on its OWN session-ended report", () => {
  const b = { screenId: "board", nodeId: "text-b" };
  expect(
    endedTextEditMatchesPendingCreation(b, {
      active: false,
      screenId: "board",
      sourceId: "text-a",
    }),
  ).toBe(false);
  expect(
    endedTextEditMatchesPendingCreation(b, {
      active: false,
      screenId: "board",
      sourceId: "text-b",
    }),
  ).toBe(true);
  expect(
    endedTextEditMatchesPendingCreation(b, {
      active: false,
      screenId: "index.html",
      sourceId: "text-b",
    }),
  ).toBe(false);
  expect(
    endedTextEditMatchesPendingCreation(b, {
      active: false,
      screenId: "board",
    }),
  ).toBe(false);
  expect(
    endedTextEditMatchesPendingCreation(b, {
      active: true,
      screenId: "board",
      sourceId: "text-b",
    }),
  ).toBe(false);
  expect(
    endedTextEditMatchesPendingCreation(null, {
      active: false,
      screenId: "board",
      sourceId: "text-b",
    }),
  ).toBe(false);
});

it("stops requesting activation once the creation is abandoned", async () => {
  vi.useFakeTimers();
  const board = document.createElement("div");
  board.dataset.boardSurfaceLayer = "";
  const iframe = document.createElement("iframe");
  iframe.dataset.designPreviewIframe = "";
  board.append(iframe);
  document.body.append(board);
  const win = iframe.contentWindow!;
  const post = vi.spyOn(win, "postMessage").mockImplementation((message) => {
    if (message.type !== "agent-native:text-edit-status") return;
    window.dispatchEvent(
      new MessageEvent("message", {
        source: win,
        data: {
          type: "agent-native:text-edit-status-result",
          correlationId: message.correlationId,
          status: "not-editing",
        },
      }),
    );
  });
  const onExhausted = vi.fn();
  scheduleBeginTextEditForScreen("board", "text", {
    boardFileId: "board",
    isAbandoned: () => true,
    onExhausted,
  });
  await vi.advanceTimersByTimeAsync(5000);

  expect(
    post.mock.calls.filter(([message]) => message.type === "begin-text-edit"),
  ).toHaveLength(0);
  expect(onExhausted).toHaveBeenCalledExactlyOnceWith("not-editing");
});

it("derives the keystroke buffer's deadline from the ladder, not beside it", () => {
  expect([...BEGIN_TEXT_EDIT_RETRY_DELAYS_MS].sort((a, b) => a - b)).toEqual(
    BEGIN_TEXT_EDIT_RETRY_DELAYS_MS,
  );
  expect(PENDING_TEXT_EDIT_TIMEOUT_MS).toBe(
    Math.max(...BEGIN_TEXT_EDIT_RETRY_DELAYS_MS) +
      BEGIN_TEXT_EDIT_ACTIVATION_CONFIRM_DELAY_MS +
      TEXT_EDIT_STATUS_PROBE_TIMEOUT_MS,
  );
});

it("keeps a live session when an earlier one on the same screen reports ended", () => {
  const b = { screenId: "board", sourceId: "text-b" };
  expect(
    endedTextEditClosesActiveSession(b, {
      screenId: "board",
      sourceId: "text-a",
    }),
  ).toBe(false);
  expect(
    endedTextEditClosesActiveSession(b, {
      screenId: "board",
      sourceId: "text-b",
    }),
  ).toBe(true);
  expect(
    endedTextEditClosesActiveSession(b, {
      screenId: "index.html",
      sourceId: "text-b",
    }),
  ).toBe(false);
  expect(endedTextEditClosesActiveSession(b, { screenId: "board" })).toBe(true);
  expect(
    endedTextEditClosesActiveSession(
      { screenId: "board" },
      { screenId: "board", sourceId: "text-a" },
    ),
  ).toBe(false);
  expect(
    endedTextEditClosesActiveSession(
      { screenId: "board" },
      { screenId: "board" },
    ),
  ).toBe(true);
  expect(
    endedTextEditClosesActiveSession(null, {
      screenId: "board",
      sourceId: "text-b",
    }),
  ).toBe(false);
});

it("never settles early on a live session once the creation is abandoned", async () => {
  vi.useFakeTimers();
  const board = document.createElement("div");
  board.dataset.boardSurfaceLayer = "";
  const iframe = document.createElement("iframe");
  iframe.dataset.designPreviewIframe = "";
  board.append(iframe);
  document.body.append(board);
  const win = iframe.contentWindow!;
  vi.spyOn(win, "postMessage").mockImplementation((message) => {
    if (message.type !== "agent-native:text-edit-status") return;
    window.dispatchEvent(
      new MessageEvent("message", {
        source: win,
        data: {
          type: "agent-native:text-edit-status-result",
          correlationId: message.correlationId,
          status: "active",
        },
      }),
    );
  });
  const onExhausted = vi.fn();
  scheduleBeginTextEditForScreen("board", "text", {
    boardFileId: "board",
    isAbandoned: () => true,
    onExhausted,
  });
  await vi.advanceTimersByTimeAsync(400);
  expect(onExhausted).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);
  expect(onExhausted).toHaveBeenCalledExactlyOnceWith("active");
});
