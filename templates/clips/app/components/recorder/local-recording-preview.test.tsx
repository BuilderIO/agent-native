// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readBackup: vi.fn() }));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/recording-backup", () => ({
  readRecoverableRecordingBackup: mocks.readBackup,
}));

import { LocalRecordingPreview } from "./local-recording-preview";

describe("LocalRecordingPreview", () => {
  let container: HTMLDivElement;
  let root: Root;
  const createObjectURL = vi.fn(() => "blob:local-recording-preview");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("plays the saved local copy and releases its object URL on unmount", async () => {
    const blob = new Blob(["video"], { type: "video/webm" });
    mocks.readBackup.mockResolvedValue({ blob });

    await act(async () => {
      root.render(
        <LocalRecordingPreview recordingId="local-1" fallbackBlob={null} />,
      );
    });

    expect(mocks.readBackup).toHaveBeenCalledWith("local-1");
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "blob:local-recording-preview",
    );
    expect(container.querySelector("video")?.controls).toBe(true);

    act(() => root.render(null));
    expect(revokeObjectURL).toHaveBeenCalledWith(
      "blob:local-recording-preview",
    );
  });

  it("uses the in-memory copy when local backup reading fails", async () => {
    const memoryCopy = new Blob(["memory copy"], { type: "video/webm" });
    mocks.readBackup.mockRejectedValue(new Error("IndexedDB unavailable"));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await act(async () => {
      root.render(
        <LocalRecordingPreview
          recordingId="local-memory"
          fallbackBlob={memoryCopy}
        />,
      );
    });

    expect(createObjectURL).toHaveBeenCalledWith(memoryCopy);
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "blob:local-recording-preview",
    );
    consoleWarn.mockRestore();
  });
});
