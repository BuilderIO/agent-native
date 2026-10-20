// @vitest-environment happy-dom
import { act, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { setNativePreviewIframeRef } from "./native-preview-iframe-lifecycle";

function Frame({ id }: { id: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const setIframeRef = useCallback((next: HTMLIFrameElement | null) => {
    setNativePreviewIframeRef(iframeRef, next);
  }, []);
  return <iframe key={id} ref={setIframeRef} data-frame-id={id} />;
}

it("disposes each iframe runtime when React replaces or unmounts the frame", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() => root.render(<Frame id="first" />));
    const first = container.querySelector("iframe")!;
    const disposeFirst = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(first.contentWindow!, "__anNativeShaders", {
      configurable: true,
      value: { dispose: disposeFirst },
    });

    await act(() => root.render(<Frame id="second" />));
    expect(disposeFirst).toHaveBeenCalledOnce();

    const second = container.querySelector("iframe")!;
    const disposeSecond = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(second.contentWindow!, "__anNativeShaders", {
      configurable: true,
      value: { dispose: disposeSecond },
    });
    await act(() => root.unmount());
    expect(disposeFirst).toHaveBeenCalledOnce();
    expect(disposeSecond).toHaveBeenCalledOnce();
  } finally {
    if (container.isConnected) container.remove();
  }
});

it("releases a foreign iframe ref when its document is inaccessible", () => {
  const frame = document.createElement("iframe");
  const ref = { current: frame };
  Object.defineProperty(frame, "contentDocument", {
    get: () => {
      throw new DOMException("Blocked cross-origin access", "SecurityError");
    },
  });
  expect(() => setNativePreviewIframeRef(ref, null)).not.toThrow();
  expect(ref.current).toBeNull();
});

it("surfaces unexpected iframe access failures", () => {
  const frame = document.createElement("iframe");
  const ref = { current: frame };
  const failure = new Error("document failed");
  Object.defineProperty(frame, "contentDocument", {
    get: () => {
      throw failure;
    },
  });
  expect(() => setNativePreviewIframeRef(ref, null)).toThrow(failure);
  expect(ref.current).toBe(frame);
});
