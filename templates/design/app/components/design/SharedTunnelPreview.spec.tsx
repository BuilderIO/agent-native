// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM":{"settings":{"disableIframePageLoading":true}}}
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SharedTunnelPreview } from "./SharedTunnelPreview";
import { REFERENCE_FRAME_LOAD_TIMEOUT_MS } from "./use-reference-frame-failure";

beforeEach(() => {
  (
    window as unknown as {
      happyDOM: { settings: { disableIframePageLoading: boolean } };
    }
  ).happyDOM.settings.disableIframePageLoading = true;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ type: "opaque" }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("./FrameRecoveryControls", () => ({
  FrameRecoveryControls: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

it("keeps live tunnel content inert while its snapshot suggestion control stays usable", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <SharedTunnelPreview url="https://demo.ngrok-free.app/flow" active />,
      ),
    );
    const frame = host.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("https://demo.ngrok-free.app/flow");
    expect(frame?.tabIndex).toBe(-1);
    // A redirect to the Design origin must stay in an opaque-origin sandbox.
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.closest("[inert]")).not.toBeNull();
    const button = host.querySelector("button");
    expect(button?.closest("[inert]")).toBeNull();
    expect(button?.textContent).toBe("designEditor.livePreview.suggest");
    await act(async () => button?.click());
    expect(host.querySelector("iframe")).toBeNull();
    expect(button?.textContent).toBe("designEditor.livePreview.live");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

async function renderPreview() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <SharedTunnelPreview url="https://demo.ngrok-free.app/flow" active />,
    ),
  );
  const cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return { host, cleanup };
}

const liveLayer = (host: HTMLElement) =>
  host.querySelector("iframe")?.parentElement as HTMLElement | undefined;
const advance = (ms: number) =>
  act(async () => void vi.advanceTimersByTime(ms));

it("keeps the snapshot visible and reports an unavailable tunnel after a failed probe", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  const { host, cleanup } = await renderPreview();
  try {
    expect(host.querySelector("iframe")).toBeNull();
    await advance(REFERENCE_FRAME_LOAD_TIMEOUT_MS - 1);
    expect(host.querySelector('[role="status"]')).toBeNull();
    await advance(1);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "designEditor.livePreview.unavailable",
    );
    expect(host.querySelector("button")?.textContent).toBe(
      "designEditor.livePreview.live",
    );
    await act(async () =>
      host.querySelector("iframe")?.dispatchEvent(new Event("load")),
    );
    expect(host.querySelector("iframe")).toBeNull();
  } finally {
    await cleanup();
  }
});

it("reveals a tunnel only after its network probe succeeds", async () => {
  vi.useFakeTimers();
  const { host, cleanup } = await renderPreview();
  try {
    await act(async () => {
      await Promise.resolve();
    });
    await advance(REFERENCE_FRAME_LOAD_TIMEOUT_MS * 2);
    expect(liveLayer(host)?.hidden).toBe(false);
  } finally {
    await cleanup();
  }
});

it("retries a timed-out tunnel with a fresh frame and timer", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  const { host, cleanup } = await renderPreview();
  try {
    await advance(REFERENCE_FRAME_LOAD_TIMEOUT_MS);
    expect(host.querySelector("iframe")).toBeNull();
    await act(async () => host.querySelector("button")?.click());
    expect(host.querySelector("iframe")).toBeNull();
    await advance(REFERENCE_FRAME_LOAD_TIMEOUT_MS);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "designEditor.livePreview.unavailable",
    );
  } finally {
    await cleanup();
  }
});
