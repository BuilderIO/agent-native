// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { completionActionCopy } from "../i18n/completion-en-US";

vi.mock("../../../shared/recording-playhead", () => ({
  RecordingPlayhead: ({ onStop }: { onStop: () => void }) => (
    <button onClick={onStop}>Stop recording</button>
  ),
}));
vi.mock("../components/live-waveform", () => ({ LiveWaveform: () => null }));

describe("completion card actions", () => {
  let host: HTMLDivElement;
  let root: Root;
  const copy = vi.fn();
  const url = "https://example.test/r/example-clip";

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
      clear: () => stored.clear(),
    };
    vi.stubGlobal("localStorage", storage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
    copy.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 0),
    );
    vi.spyOn(window, "open").mockReturnValue(window);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const { RecordingPill } = await import("./record-pill");
    await act(async () => root.render(<RecordingPill />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function button(label: string) {
    const found = [...host.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === label,
    );
    expect(found, `button ${label}`).toBeDefined();
    return found!;
  }

  async function showCard(ok = false) {
    localStorage.setItem(
      "clips-finalizing-result",
      JSON.stringify({ recordingId: "example-clip", viewUrl: url, ok }),
    );
    await act(async () => button("Stop recording").click());
    expect(host.textContent).toContain(
      ok ? "Recording saved" : "Upload paused",
    );
  }

  it.each([false, true])(
    "dismisses after Open succeeds (uploaded=%s)",
    async (uploaded) => {
      await showCard(uploaded);
      await act(async () => button("Open").click());
      expect(window.open).toHaveBeenCalledExactlyOnceWith(url, "_blank");
      expect(host.querySelector('[aria-label="Dismiss"]')).toBeNull();
      expect(
        [...host.querySelectorAll("button")].some(
          (element) => element.textContent === "Open",
        ),
      ).toBe(false);
    },
  );

  it.each(["Copy", "url", "icon"])(
    "dismisses after successful copying through %s",
    async (target) => {
      await showCard();
      const control =
        target === "Copy"
          ? button("Copy")
          : target === "url"
            ? button("example.test/r/example-clip")
            : host.querySelectorAll<HTMLButtonElement>(
                '[aria-label="Copy link"]',
              )[1];
      await act(async () => control.click());
      expect(copy).toHaveBeenCalledExactlyOnceWith(url);
      expect(host.querySelector('[aria-label="Dismiss"]')).toBeNull();
    },
  );

  it("keeps the card and surfaces a clipboard rejection", async () => {
    await showCard();
    copy.mockRejectedValueOnce(new Error("Example clipboard failure"));
    await act(async () => button("Copy").click());
    expect(host.textContent).toContain("Upload paused");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      completionActionCopy.copyFailed,
    );
    expect(button("Copy").disabled).toBe(false);
  });

  it("keeps the card and surfaces a blocked browser open", async () => {
    await showCard();
    vi.mocked(window.open).mockReturnValueOnce(null);
    await act(async () => button("Open").click());
    expect(host.textContent).toContain("Upload paused");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      completionActionCopy.openFailed,
    );
  });

  it("does not dismiss before asynchronous copy succeeds", async () => {
    await showCard();
    let finish!: () => void;
    copy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => button("Copy").click());
    expect(host.querySelector('[aria-label="Dismiss"]')).not.toBeNull();
    expect(button("Copy").disabled).toBe(true);
    await act(async () => finish());
    expect(host.querySelector('[aria-label="Dismiss"]')).toBeNull();
  });

  it("does not resurrect a dismissed browser card when late completion arrives", async () => {
    await showCard();
    await act(async () => button("Copy").click());
    await act(async () => vi.advanceTimersByTimeAsync(2_100));
    expect(host.querySelector('[aria-label="Dismiss"]')).toBeNull();
    expect(host.textContent).not.toContain("Recording saved");
    expect(copy).toHaveBeenCalledOnce();
  });

  it("does not dismiss or copy from completion-state updates alone", async () => {
    await showCard();
    await act(async () => vi.advanceTimersByTimeAsync(2_100));
    expect(host.querySelector('[aria-label="Dismiss"]')).not.toBeNull();
    expect(copy).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });
});
