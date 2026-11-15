// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM":{"settings":{"disableIframePageLoading":true}}}
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { SharedTunnelPreview } from "./SharedTunnelPreview";

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
