// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async () => {
  const { default: messages } = await import("../../../app/i18n/en-US");
  const translate = (key: string, options?: Record<string, unknown>) => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        messages,
      );
    if (typeof value !== "string") return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(options?.[name] ?? ""),
    );
  };
  return { useT: () => translate };
});

import type { RecordingContextItem } from "./context-api";
import {
  LookbackEditDialog,
  type LookbackEditDialogProps,
} from "./LookbackEditDialog";

// jsdom has no media pipeline: play() and pause() are not implemented.
// currentTime is stored, so seeking and the playhead can be asserted.
const playMock = vi.fn(async () => {});
const pauseMock = vi.fn();
HTMLMediaElement.prototype.play = playMock as HTMLMediaElement["play"];
HTMLMediaElement.prototype.pause = pauseMock;

// convertFileSrc reads the webview bridge, which jsdom does not provide.
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  convertFileSrc: (path: string, protocol = "asset") =>
    `${protocol}://localhost/${encodeURIComponent(path)}`,
};
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  playMock.mockClear();
  pauseMock.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

// The widest window is five minutes; the saved window is its last thirty seconds.
const ORIGINAL = {
  startedAt: "2026-10-09T10:00:00.000Z",
  endedAt: "2026-10-09T10:05:00.000Z",
};

const item = {
  id: "ctx1",
  recordingId: "rec1",
  requestedSeconds: 30,
  originalStartedAt: ORIGINAL.startedAt,
  originalEndedAt: ORIGINAL.endedAt,
  startedAt: "2026-10-09T10:04:30.000Z",
  endedAt: "2026-10-09T10:05:00.000Z",
  status: "ready",
} as RecordingContextItem;

const PREVIEW_PATH =
  "/Users/steve/Library/Application Support/clips/screen-memory/previews/preview-abc123.mp4";

function previewInvoke(
  outcome: () => Promise<unknown> = async () => ({ path: PREVIEW_PATH }),
) {
  return vi.fn(async (command: string) =>
    command === "rewind_preview_window" ? outcome() : undefined,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderDialog(overrides: Partial<LookbackEditDialogProps> = {}) {
  const props: LookbackEditDialogProps = {
    item,
    open: true,
    onOpenChange: vi.fn(),
    onSave: vi.fn(async () => {}),
    onRemove: vi.fn(async () => {}),
    invoke: previewInvoke(),
    ...overrides,
  };
  act(() => {
    root.render(<LookbackEditDialog {...props} />);
  });
  return props;
}

function setOpen(props: LookbackEditDialogProps, open: boolean) {
  act(() => {
    root.render(<LookbackEditDialog {...props} open={open} />);
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

function saveButton(): HTMLButtonElement | undefined {
  return buttonWithText("Save");
}

function video(): HTMLVideoElement {
  const element = document.querySelector<HTMLVideoElement>("video");
  if (!element) throw new Error("preview video is missing");
  return element;
}

function startHandle(): HTMLElement {
  const handle = document.querySelector<HTMLElement>(
    '[role="slider"][aria-label="Window start"]',
  );
  if (!handle) throw new Error("start handle is missing");
  return handle;
}

describe("LookbackEditDialog preview", () => {
  it("debounces range changes and serializes preview cuts", async () => {
    vi.useFakeTimers();
    const firstCut = deferred<{ path: string }>();
    const secondCut = deferred<{ path: string }>();
    const secondRequestStarted = deferred<void>();
    const secondRequestReturned = deferred<void>();
    let activePreviews = 0;
    let maximumActivePreviews = 0;
    let previewCount = 0;
    const invoke = vi.fn(async (command: string) => {
      if (command !== "rewind_preview_window") return undefined;
      const index = previewCount++;
      if (index === 1) secondRequestStarted.resolve();
      activePreviews += 1;
      maximumActivePreviews = Math.max(maximumActivePreviews, activePreviews);
      try {
        const result = await (index === 0 ? firstCut : secondCut).promise;
        if (index === 1) secondRequestReturned.resolve();
        return result;
      } finally {
        activePreviews -= 1;
      }
    });
    renderDialog({ invoke });

    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      act(() => {
        startHandle().dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(219);
    });
    expect(previewCount).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(previewCount).toBe(1);
    expect(invoke).toHaveBeenCalledWith("rewind_preview_window", {
      startedAt: "2026-10-09T10:04:33.000Z",
      endedAt: item.endedAt,
    });

    act(() => {
      startHandle().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });
    expect(previewCount).toBe(1);

    await act(async () => {
      firstCut.resolve({ path: PREVIEW_PATH });
      await secondRequestStarted.promise;
    });
    expect(previewCount).toBe(2);
    expect(maximumActivePreviews).toBe(1);
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "rewind_preview_window",
      ),
    ).toEqual([
      [
        "rewind_preview_window",
        {
          startedAt: "2026-10-09T10:04:33.000Z",
          endedAt: item.endedAt,
        },
      ],
      [
        "rewind_preview_window",
        {
          startedAt: "2026-10-09T10:04:34.000Z",
          endedAt: item.endedAt,
        },
      ],
    ]);

    await act(async () => {
      secondCut.resolve({ path: PREVIEW_PATH });
      await secondRequestReturned.promise;
    });
  });

  it("previews the selected range instead of the whole five-minute window", async () => {
    const invoke = previewInvoke();
    renderDialog({ invoke });
    await flush();

    expect(invoke).toHaveBeenCalledWith("rewind_preview_window", {
      startedAt: item.startedAt,
      endedAt: item.endedAt,
    });
  });

  it("shows the preparing state until the cut's metadata loads", async () => {
    const pending = deferred<{ path: string }>();
    renderDialog({ invoke: previewInvoke(() => pending.promise) });
    expect(document.body.textContent).toContain("Preparing preview…");
    expect(buttonWithText("Play selection")?.disabled).toBe(true);

    await act(async () => pending.resolve({ path: PREVIEW_PATH }));
    await flush();
    expect(video().getAttribute("src")).toContain("preview-abc123.mp4");
    expect(document.body.textContent).toContain("Preparing preview…");
    expect(buttonWithText("Play selection")?.disabled).toBe(true);

    act(() => {
      video().dispatchEvent(new Event("loadedmetadata"));
    });
    expect(document.body.textContent).not.toContain("Preparing preview…");
    expect(buttonWithText("Play selection")?.disabled).toBe(false);
  });

  it("shows an error with Retry, and loads the cut again on retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let attempts = 0;
    const invoke = previewInvoke(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("no local footage");
      return { path: PREVIEW_PATH };
    });
    renderDialog({ invoke });
    await flush();

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't prepare the preview.",
    );
    expect(document.querySelector("video")).toBeNull();

    await act(async () => {
      buttonWithText("Retry")?.click();
    });
    await flush();

    expect(attempts).toBe(2);
    expect(video().getAttribute("src")).toContain("preview-abc123.mp4");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("keeps the selection editable after a preview error and previews its new range", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let attempts = 0;
    const invoke = previewInvoke(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("coverage gap");
      return { path: PREVIEW_PATH };
    });
    renderDialog({ invoke });
    await flush();

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't prepare the preview.",
    );
    expect(startHandle().getAttribute("aria-disabled")).toBeNull();

    act(() => {
      startHandle().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await flush();

    expect(attempts).toBe(2);
    expect(invoke).toHaveBeenLastCalledWith("rewind_preview_window", {
      startedAt: "2026-10-09T10:04:31.000Z",
      endedAt: item.endedAt,
    });
    expect(video().getAttribute("src")).toContain("preview-abc123.mp4");
    warn.mockRestore();
  });

  it("discards the cut when the dialog closes by any route", async () => {
    const invoke = previewInvoke();
    const props = renderDialog({ invoke });
    await flush();

    act(() => {
      buttonWithText("Cancel")?.click();
    });
    setOpen(props, false);
    await flush();

    expect(invoke).toHaveBeenCalledWith("rewind_preview_discard", {
      path: PREVIEW_PATH,
    });
  });

  it("discards a cut that arrives after the dialog has closed", async () => {
    const pending = deferred<{ path: string }>();
    const invoke = previewInvoke(() => pending.promise);
    const props = renderDialog({ invoke });
    await flush();
    setOpen(props, false);

    await act(async () => pending.resolve({ path: PREVIEW_PATH }));
    await flush();

    expect(invoke).toHaveBeenCalledWith("rewind_preview_discard", {
      path: PREVIEW_PATH,
    });
  });

  it("plays the selection from its start, stops at its end, and moves the playhead", async () => {
    renderDialog();
    await flush();
    act(() => {
      video().dispatchEvent(new Event("loadedmetadata"));
    });
    expect(
      document.querySelector<HTMLElement>("[data-playhead]")?.style.left,
    ).toBe("90%");

    // The preview is the selected 30 s range, so playback starts at its first frame.
    act(() => {
      buttonWithText("Play selection")?.click();
    });
    expect(video().currentTime).toBe(0);
    expect(playMock).toHaveBeenCalledTimes(1);

    video().currentTime = 12;
    act(() => {
      video().dispatchEvent(new Event("timeupdate"));
    });
    expect(
      document.querySelector<HTMLElement>("[data-playhead]")?.style.left,
    ).toBe("94%");
    expect(pauseMock).not.toHaveBeenCalled();

    video().currentTime = 30;
    act(() => {
      video().dispatchEvent(new Event("timeupdate"));
    });
    expect(pauseMock).toHaveBeenCalledTimes(1);
  });
});

describe("LookbackEditDialog", () => {
  it("keeps Save disabled until the window changes", () => {
    renderDialog({ onSave: vi.fn(async () => {}) });

    expect(document.body.textContent).toContain("Earlier screen time");
    expect(saveButton()?.disabled).toBe(true);
  });

  it("saves a narrower window and closes after success", async () => {
    const onSave = vi.fn(async () => {});
    const props = renderDialog({ onSave });

    act(() => {
      startHandle().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(saveButton()?.disabled).toBe(false);

    await act(async () => {
      saveButton()?.click();
    });

    expect(onSave).toHaveBeenCalledWith({
      startedAt: "2026-10-09T10:04:31.000Z",
      endedAt: "2026-10-09T10:05:00.000Z",
    });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open with the error when the save is rejected", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("server 500");
    });
    const props = renderDialog({ onSave });

    act(() => {
      startHandle().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await act(async () => {
      saveButton()?.click();
    });

    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't save the window. Try again.",
    );
    expect(saveButton()?.disabled).toBe(false);
  });

  it("reads the window against the recording start", () => {
    renderDialog();

    // The saved window starts 30 s before the recording start and ends at it.
    expect(document.body.textContent).toContain("From 0:30 before");
    expect(document.body.textContent).toContain("To recording start");
  });
});

describe("LookbackEditDialog removal", () => {
  function removeAction(): HTMLButtonElement | undefined {
    return buttonWithText("Remove earlier screen time");
  }

  function confirmRemove(): HTMLButtonElement | undefined {
    return buttonWithText("Remove");
  }

  it("asks for confirmation in the app before removing anything", async () => {
    const onRemove = vi.fn(async () => {});
    renderDialog({ onRemove });
    await flush();

    act(() => {
      removeAction()?.click();
    });

    expect(document.body.textContent).toContain("Remove earlier screen time?");
    expect(document.body.textContent).toContain(
      "The footage is moved to Trash and the clip no longer includes it.",
    );
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("removes the item and closes the dialog once the removal succeeds", async () => {
    const onRemove = vi.fn(async () => {});
    const props = renderDialog({ onRemove });
    await flush();
    act(() => {
      removeAction()?.click();
    });

    await act(async () => {
      confirmRemove()?.click();
    });
    await flush();

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(document.body.textContent).not.toContain(
      "Remove earlier screen time?",
    );
  });

  it("discards the cut when a removal closes the dialog", async () => {
    const invoke = previewInvoke();
    const props = renderDialog({ invoke });
    await flush();
    act(() => {
      removeAction()?.click();
    });
    await act(async () => {
      confirmRemove()?.click();
    });

    setOpen(props, false);
    await flush();

    expect(invoke).toHaveBeenCalledWith("rewind_preview_discard", {
      path: PREVIEW_PATH,
    });
  });

  it("stays open with the error when the removal is rejected", async () => {
    const onRemove = vi.fn(async () => {
      throw new Error("server 500");
    });
    const props = renderDialog({ onRemove });
    await flush();
    act(() => {
      removeAction()?.click();
    });

    await act(async () => {
      confirmRemove()?.click();
    });
    await flush();

    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't remove earlier screen time for the discarded recording.",
    );
    expect(document.body.textContent).not.toContain(
      "Remove earlier screen time?",
    );
  });
});
