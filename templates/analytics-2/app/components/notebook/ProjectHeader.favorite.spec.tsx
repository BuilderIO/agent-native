// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => <span />,
}));

import { i18nCatalog } from "@/i18n";

import { ProjectHeader as View } from "./ProjectHeader";

function ProjectHeader(props: ComponentProps<typeof View>) {
  return (
    <MemoryRouter>
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <View {...props} />
      </AgentNativeI18nProvider>
    </MemoryRouter>
  );
}

async function openProjectMenu(container: HTMLElement) {
  const trigger = container.querySelector('[aria-label="Project options"]');
  if (trigger == null) throw new Error("project menu trigger is missing");
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
  const menu = document.querySelector(
    '[role="menu"][aria-label="Project options"]',
  );
  if (menu == null) throw new Error("project menu did not open");
  return menu;
}

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("report A2-PROJECT-MENU-FAVORITE toggles the favorite and restores its prior state if saving fails", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const save = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new Error("Save failed"));
  await act(async () =>
    root.render(
      <ProjectHeader
        title="Revenue"
        canRename
        onRename={async () => {}}
        favorited={false}
        onFavorite={save}
        favoriteLabel="Favorite this project"
        unfavoriteLabel="Remove from your favorites"
      />,
    ),
  );
  const find = (menu: Element, text: string) =>
    [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === text,
    );
  const initialMenu = await openProjectMenu(container);
  const favorite = find(initialMenu, "Favorite this project");
  expect(favorite).toBeDefined();
  if (!favorite) throw new Error("Favorite action missing");
  await act(async () => favorite.click());
  expect(save).toHaveBeenCalledWith(true);
  const savedMenu = await openProjectMenu(container);
  const unfavorite = find(savedMenu, "Remove from your favorites");
  expect(unfavorite).toBeDefined();
  if (!unfavorite) throw new Error("Unfavorite action missing");
  await act(async () => unfavorite.click());
  expect(save).toHaveBeenCalledWith(false);
  const restoredMenu = await openProjectMenu(container);
  expect(find(restoredMenu, "Remove from your favorites")).toBeDefined();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Save failed",
  );
  await act(async () => root.unmount());
  container.remove();
});

it("shows an already saved favorite when the header mounts", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ProjectHeader
        title="Revenue"
        canRename
        onRename={async () => {}}
        favorited
        onFavorite={async (value) => value}
        favoriteLabel="Favorite this project"
        unfavoriteLabel="Remove from your favorites"
      />,
    ),
  );
  const menu = await openProjectMenu(container);
  expect(menu.textContent).toContain("Remove from your favorites");
  await act(async () => root.unmount());
  container.remove();
});
