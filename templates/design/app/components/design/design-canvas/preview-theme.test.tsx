// @vitest-environment happy-dom

import type { PreviewColorScheme } from "@shared/preview-color-scheme";
import { act, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PREVIEW_COLOR_SCHEME_MESSAGE,
  usePreviewThemeChannel,
  type PreviewThemeStatus,
} from "./preview-theme";

const unmounts: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (unmounts.length) await unmounts.pop()!();
});

function fakeFrame() {
  const postMessage = vi.fn();
  const iframeRef = {
    current: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement,
  } as RefObject<HTMLIFrameElement | null>;
  return { iframeRef, postMessage };
}

async function mountChannel(
  initial: { scheme: PreviewColorScheme | null; bridgeReachable: boolean },
  onStatus: (screenId: string | undefined, status: PreviewThemeStatus) => void,
) {
  const { iframeRef, postMessage } = fakeFrame();
  function Harness(props: typeof initial) {
    usePreviewThemeChannel({
      iframeRef,
      screenId: "screen-1",
      onStatus,
      ...props,
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness {...initial} />));
  unmounts.push(() =>
    act(async () => root.unmount()).then(() => host.remove()),
  );
  const rerender = (props: typeof initial) =>
    act(async () => root.render(<Harness {...props} />));
  return { postMessage, rerender };
}

describe("usePreviewThemeChannel", () => {
  it("sends the scheme to a frame that runs the bridge, and again when it changes", async () => {
    const { postMessage, rerender } = await mountChannel(
      { scheme: "light", bridgeReachable: true },
      vi.fn(),
    );
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: PREVIEW_COLOR_SCHEME_MESSAGE, scheme: "light" },
      "*",
    );
    await rerender({ scheme: "dark", bridgeReachable: true });
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: PREVIEW_COLOR_SCHEME_MESSAGE, scheme: "dark" },
      "*",
    );
  });

  it("reports a URL-backed frame as unavailable and never messages the page", async () => {
    const onStatus = vi.fn();
    const { postMessage, rerender } = await mountChannel(
      { scheme: null, bridgeReachable: false },
      onStatus,
    );
    await rerender({ scheme: "dark", bridgeReachable: false });
    expect(onStatus).toHaveBeenCalledWith("screen-1", { kind: "unavailable" });
    expect(postMessage).not.toHaveBeenCalled();
  });
});
