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

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected element to render");
  return value;
}

describe("LayersPanel section heads", () => {
  async function renderPanel() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LayersPanel
          screens={[
            { id: "s1", name: "Home" },
            { id: "s2", name: "Pricing" },
          ]}
          activeScreenId="s1"
          layers={[{ id: "l1", name: "Hero", type: "element" }]}
          selectedIds={[]}
          expandedIds={[]}
          searchQuery=""
          onSearchQueryChange={() => {}}
          onExpandedIdsChange={() => {}}
          onSelectionChange={() => {}}
          onToggleHidden={() => {}}
        />,
      );
    });
    const head = (id: string) =>
      required(
        host.querySelector<HTMLElement>(`[data-layers-panel-header="${id}"]`),
      );
    const toggle = (id: string) =>
      required(
        head(id).querySelector<HTMLButtonElement>("[data-tree-section-toggle]"),
      );
    return { host, root, head, toggle };
  }

  it("lists pages under a 40px Pages head with no All screens row", async () => {
    const { host, root, head } = await renderPanel();
    for (const id of ["screens", "layers"]) {
      expect(head(id).classList).toContain("h-[var(--design-section-height)]");
      expect(head(id).classList).toContain("sticky");
    }
    expect(head("screens").textContent).toContain("layersPanel.screens");
    expect(host.textContent).not.toContain("layersPanel.allScreens");
    const pages = host.querySelectorAll<HTMLElement>("[data-screen-row]");
    expect(Array.from(pages, (row) => row.textContent)).toEqual([
      "Home",
      "Pricing",
    ]);
    expect(pages[0]?.getAttribute("aria-current")).toBe("page");
    expect(pages[0]?.querySelectorAll("[data-layer-row-indent]")).toHaveLength(
      0,
    );
    root.unmount();
  });

  it("folds each section from its head", async () => {
    const { host, root, toggle } = await renderPanel();
    expect(toggle("screens").getAttribute("aria-expanded")).toBe("true");
    await act(async () => toggle("screens").click());
    expect(toggle("screens").getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("[data-screen-row]")).toBeNull();
    expect(host.querySelector("[data-screen-section-resizer]")).toBeNull();

    await act(async () => toggle("layers").click());
    expect(toggle("layers").getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[role="tree"]')?.closest("[hidden]")).not.toBe(
      null,
    );
    root.unmount();
  });
});
