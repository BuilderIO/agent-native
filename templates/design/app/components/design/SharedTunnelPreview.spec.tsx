// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { SharedTunnelPreview } from "./SharedTunnelPreview";

afterEach(() => vi.unstubAllGlobals());

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { hostname?: string }) =>
    values?.hostname ? `${key}:${values.hostname}` : key,
}));

it("shows the published snapshot by default and offers an explicit safe top-level live link", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <SharedTunnelPreview url="https://demo.ngrok-free.app/flow" />,
      ),
    );
    expect(host.querySelector("iframe")).toBeNull();
    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://demo.ngrok-free.app/flow");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toContain("demo.ngrok-free.app");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
