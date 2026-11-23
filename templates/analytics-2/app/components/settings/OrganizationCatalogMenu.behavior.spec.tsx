// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { OrganizationCatalogMenu } from "./OrganizationCatalogMenu";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("OrganizationCatalogMenu delete confirmation focuses Delete and closes on Escape", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const remove = vi.fn(async () => {});
  act(() =>
    root.render(
      <OrganizationCatalogMenu
        entry={{
          id: "st_1",
          name: "QA status",
          color: "#000000",
          description: "",
          endorsed: false,
          inLibrary: false,
          enforcesReview: false,
        }}
        isStatus
        showLibrary={false}
        isDefault={false}
        names={["QA status"]}
        save={async () => {}}
        remove={remove}
      />,
    ),
  );
  try {
    const trigger = container.querySelector<HTMLButtonElement>("button");
    if (!trigger) throw Error("Menu trigger missing");
    act(() => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const deleteMenuItem = await vi.waitFor(() => {
      const item = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].find((el) => /delete/i.test(el.textContent ?? ""));
      if (!item) throw Error("Delete menu item missing");
      return item;
    });
    act(() => {
      deleteMenuItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const confirm = await vi.waitFor(() => {
      const dialog = document.querySelector('[role="alertdialog"]');
      if (!dialog) throw Error("Confirmation dialog did not open");
      const button = [...dialog.querySelectorAll("button")].find((b) =>
        /delete/i.test(b.textContent ?? ""),
      );
      if (!button) throw Error("Confirm button missing");
      expect(document.activeElement).toBe(button);
      return button;
    });
    expect(document.activeElement).toBe(confirm);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    });
    expect(remove).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
