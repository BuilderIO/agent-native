// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import { scheduleBeginTextEditForScreen } from "./text-edit-utils";

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
