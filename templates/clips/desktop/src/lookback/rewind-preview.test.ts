// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  discardRewindPreview,
  loadRewindPreview,
  type RewindInvoke,
} from "./rewind-preview";

// convertFileSrc reads the webview bridge, which jsdom does not provide.
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  convertFileSrc: (path: string, protocol = "asset") =>
    `${protocol}://localhost/${encodeURIComponent(path)}`,
};

const range = {
  startedAt: "2026-10-09T10:00:00.000Z",
  endedAt: "2026-10-09T10:05:00.000Z",
};

describe("loadRewindPreview", () => {
  it("asks Rewind for the window and returns a playable source for the cut", async () => {
    const invoke = vi.fn<RewindInvoke>(async () => ({
      path: "/previews/preview-a.mp4",
    }));

    const preview = await loadRewindPreview(range, invoke);

    expect(invoke).toHaveBeenCalledWith("rewind_preview_window", {
      startedAt: range.startedAt,
      endedAt: range.endedAt,
    });
    expect(preview.path).toBe("/previews/preview-a.mp4");
    expect(preview.src).toBe(
      `asset://localhost/${encodeURIComponent("/previews/preview-a.mp4")}`,
    );
  });

  it("fails a response without a path instead of playing an empty source", async () => {
    const missing = vi.fn<RewindInvoke>(async () => ({}));
    await expect(loadRewindPreview(range, missing)).rejects.toThrow(
      "no preview path",
    );

    const empty = vi.fn<RewindInvoke>(async () => null);
    await expect(loadRewindPreview(range, empty)).rejects.toThrow(
      "no preview path",
    );
  });
});

describe("discardRewindPreview", () => {
  it("asks Rewind to delete the preview by its path", async () => {
    const invoke = vi.fn<RewindInvoke>(async () => undefined);

    await discardRewindPreview("/previews/preview-a.mp4", invoke);

    expect(invoke).toHaveBeenCalledWith("rewind_preview_discard", {
      path: "/previews/preview-a.mp4",
    });
  });
});
