// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { SectionCell } from "./SectionCell";

describe("SectionCell rename", () => {
  it("keeps the rename input open and focused when Rename cell is selected from the menu", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onConfigure = vi.fn();

    try {
      await act(async () =>
        root.render(
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <SectionCell
              id="sec_1"
              title="Old section"
              collapsed={false}
              depth={0}
              selected={false}
              empty
              canDrag={false}
              canChangeStructure
              configPending={false}
              runBusy={false}
              onToggle={() => {}}
              onConfigure={onConfigure}
              onDelete={async () => true}
              onEject={() => {}}
            >
              {null}
            </SectionCell>
          </AgentNativeI18nProvider>,
        ),
      );

      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label*="More actions for"]',
      );
      expect(trigger).not.toBeNull();
      await act(async () => {
        trigger!.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
        );
        trigger!.click();
      });

      const items = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ];
      const renameItem = items.find(
        (el) => el.textContent?.trim() === "Rename cell",
      );
      expect(renameItem).toBeDefined();
      await act(async () => {
        renameItem!.click();
      });

      const input = host.querySelector<HTMLInputElement>(
        "input.nb-cell-title-input",
      );
      expect(input).not.toBeNull();
      expect(document.activeElement).toBe(input);

      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, "Renamed section");
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        input!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });

      expect(onConfigure).toHaveBeenCalledWith({ title: "Renamed section" });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
