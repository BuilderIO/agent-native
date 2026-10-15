// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { LayersPanel } from "./LayersPanel";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

async function renderScreens(onAddScreen?: () => void) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <LayersPanel
        screens={[{ id: "s1", name: "Home" }]}
        selectedIds={[]}
        expandedIds={[]}
        searchQuery=""
        onSearchQueryChange={() => {}}
        onExpandedIdsChange={() => {}}
        onSelectionChange={() => {}}
        onAddScreen={onAddScreen}
      />,
    );
  });
  const button = host.querySelector<HTMLButtonElement>(
    '[data-layers-panel-action="add-screen"]',
  );
  return { button, root };
}

describe("LayersPanel add screen", () => {
  it("is disabled when the viewer cannot add screens", async () => {
    const { button, root } = await renderScreens(undefined);
    expect(button?.disabled).toBe(true);
    root.unmount();
  });

  it("adds a screen for an editor", async () => {
    const onAddScreen = vi.fn();
    const { button, root } = await renderScreens(onAddScreen);
    expect(button?.disabled).toBe(false);
    await act(async () => {
      button?.click();
    });
    expect(onAddScreen).toHaveBeenCalledOnce();
    root.unmount();
  });
});
