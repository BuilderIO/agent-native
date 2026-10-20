// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShareSendToTab } from "./share-send-to-tab";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function mount({
  exportsUnavailable,
  codingHandoffLoading = false,
  onCopyCodingHandoff = vi.fn(),
}: {
  exportsUnavailable: boolean;
  codingHandoffLoading?: boolean;
  onCopyCodingHandoff?: () => void | Promise<void>;
}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ShareSendToTab
        codingHandoffPreviewText="Implement: design.tsx"
        exportsUnavailable={exportsUnavailable}
        codingHandoffLoading={codingHandoffLoading}
        onCopyCodingHandoff={onCopyCodingHandoff}
      />,
    );
  });
  cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return host;
}

describe("ShareSendToTab", () => {
  it("disables copying while initial generation has no canvas frames", async () => {
    const onCopyCodingHandoff = vi.fn();
    const host = await mount({
      exportsUnavailable: true,
      onCopyCodingHandoff,
    });
    const button = host.querySelector("button");

    expect(button?.disabled).toBe(true);
    await act(async () => button?.click());
    expect(onCopyCodingHandoff).not.toHaveBeenCalled();
  });

  it("allows copying when exports are available", async () => {
    const onCopyCodingHandoff = vi.fn();
    const host = await mount({
      exportsUnavailable: false,
      onCopyCodingHandoff,
    });
    const button = host.querySelector("button");

    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
    expect(onCopyCodingHandoff).toHaveBeenCalledOnce();
  });

  it("keeps copying disabled while the handoff is loading", async () => {
    const host = await mount({
      exportsUnavailable: false,
      codingHandoffLoading: true,
    });

    expect(host.querySelector("button")?.disabled).toBe(true);
  });
});
