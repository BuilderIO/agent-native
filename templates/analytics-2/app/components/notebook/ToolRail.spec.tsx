// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import * as secondaryFeatures from "@/components/shell/secondary-features";

import { ToolRail } from "./ToolRail";

it("offers Components only when secondary features are enabled", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  const gate = vi.spyOn(secondaryFeatures, "secondaryFeaturesEnabled");
  try {
    gate.mockReturnValue(false);
    await act(async () => root.render(<ToolRail onSelect={onSelect} />));
    expect(container.querySelector('[aria-label="Components"]')).toBeNull();
    expect(container.querySelector('[aria-label="Files"]')).not.toBeNull();

    gate.mockReturnValue(true);
    await act(async () => root.render(<ToolRail onSelect={onSelect} />));
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Components"]',
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(onSelect).toHaveBeenCalledWith("components");
  } finally {
    gate.mockRestore();
    act(() => root.unmount());
    container.remove();
  }
});
