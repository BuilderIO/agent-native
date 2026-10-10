// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { ShaderFillsPanel } from "./ShaderFillsPanel";

const descriptor = {
  preset: "MeshGradient" as const,
  params: { distortion: 0.8 },
  colors: ["#e0eaff", "#241d9a"],
};

describe("historical shader inspector", () => {
  it("shows saved settings without a new preset choice, preview engine, or mutation", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onApply = vi.fn();
    const onCommit = vi.fn();
    try {
      act(() => {
        root.render(
          <ShaderFillsPanel
            descriptor={descriptor}
            onApply={onApply}
            onCommit={onCommit}
            onBack={() => undefined}
          />,
        );
      });
      expect(host.textContent).toContain(
        "editPanel.shaders.legacyDescriptorOnly",
      );
      expect(host.textContent).toContain("Mesh Gradient");
      expect(host.textContent).toContain("distortion");
      expect(host.querySelector("canvas")).toBeNull();
      expect(host.querySelector("[aria-label='Create new shader']")).toBeNull();
      expect(onApply).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
