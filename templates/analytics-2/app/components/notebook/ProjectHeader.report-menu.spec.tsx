// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

import { ProjectHeader } from "./ProjectHeader";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("reports QA-1795061813.689229 and QA-1795061966.611539: header menu has a separate export submenu and source inventory", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const exportYaml = vi.fn();
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <AgentNativeI18nProvider
            catalog={i18nCatalog}
            persistPreference={false}
          >
            <ProjectHeader
              title="QA project"
              canRename
              onRename={async () => {}}
              onFavorite={async (v) => v}
              favoriteLabel="Favorite this project"
              onDuplicate={() => {}}
              onExportYaml={exportYaml}
              onExportIpynb={() => {}}
              onStatus={() => {}}
              onClearOutputs={() => {}}
              onCategories={() => {}}
              onTransfer={() => {}}
              onAddToCollection={() => {}}
              onArchive={async () => {}}
              onTrash={async () => {}}
              onNewProject={async () => {}}
            />
          </AgentNativeI18nProvider>
        </MemoryRouter>,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Project options"]',
    );
    if (!trigger) throw Error("Menu trigger missing");
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const menu = document.querySelector(
      '[role="menu"][aria-label="Project options"]',
    );
    if (!menu) throw Error("Menu did not open");
    const labels = [...menu.querySelectorAll('[role="menuitem"]')].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).toEqual([
      "Rename",
      "Favorite this project",
      "Duplicate",
      "Export as",
      "Set status",
      "Clear outputs",
      "Add categories",
      "Transfer project owner",
      "Add to collection",
      "Move to...",
      "Archive",
      "Move to trash",
      "New project",
    ]);
    expect(document.body.textContent).not.toContain(
      "Analytics project (.yaml)",
    );
    const submenu = [
      ...menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((node) => node.textContent?.trim() === "Export as");
    if (!submenu) throw Error("Export trigger missing");
    expect(submenu.getAttribute("aria-haspopup")).toBe("menu");
    await act(async () => {
      submenu.focus();
      submenu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    const exportMenu = document.querySelector(
      '[role="menu"][aria-label="Export as"]',
    );
    if (!exportMenu) throw Error("Export menu did not open");
    const exportItems = [
      ...exportMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    expect(exportItems.map((node) => node.textContent?.trim())).toEqual([
      "Analytics project (.yaml)",
      "Jupyter notebook (.ipynb)",
    ]);
    const yaml = exportItems.find(
      (node) => node.textContent?.trim() === "Analytics project (.yaml)",
    );
    expect(yaml).toBeDefined();
    await act(async () => yaml?.click());
    expect(exportYaml).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
