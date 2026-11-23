// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ControlledPopover } from "../../skins/reference/sidebar-shell/ControlledPopover";
import { Popover } from "./Popover";

afterEach(() => vi.restoreAllMocks());

it.each([
  {
    name: "uncontrolled",
    controlled: false,
    height: 115,
    top: 48,
    bottom: 76,
    expectedMaxHeight: "36px",
  },
  {
    name: "controlled",
    controlled: true,
    height: 400,
    top: 293,
    bottom: 321,
    expectedMaxHeight: "281px",
  },
])(
  "keeps the $name menu in the available space above the trigger",
  async ({ controlled, height, top, bottom, expectedMaxHeight }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerHeight", height);
    const parent = document.createElement("div");
    document.body.append(parent);
    const root = createRoot(parent);

    function Fixture() {
      const [open, setOpen] = useState(false);
      const props = {
        label: "Test menu",
        role: "menu" as const,
        trigger: (
          props: Parameters<Parameters<typeof Popover>[0]["trigger"]>[0],
        ) => <button {...props}>Open menu</button>,
        children: <button data-menu-item="true">Menu action</button>,
      };
      return controlled ? (
        <ControlledPopover
          {...props}
          entry={{
            id: "test-menu",
            kind: "action",
            part: "sidebar",
            subPart: "sidebar.header",
            containerId: "test",
            order: 0,
            effect: {
              kind: "open",
              surfaceId: "test-menu",
              body: { owner: "model", key: "test-menu" },
              open: { value: open, set: setOpen },
            },
          }}
        />
      ) : (
        <Popover {...props} />
      );
    }

    try {
      await act(() => root.render(<Fixture />));
      const trigger = parent.querySelector("button")!;
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(
        new DOMRect(12, top, 28, bottom - top),
      );
      await act(() => trigger.click());
      const panel = document.querySelector<HTMLElement>('[role="menu"]')!;
      expect(panel.style.top).toBe("");
      expect(panel.style.bottom).toBe(`${height - top + 4}px`);
      expect(panel.style.maxHeight).toBe(expectedMaxHeight);
      expect(panel.style.overflowY).toBe("auto");
    } finally {
      await act(() => root.unmount());
      parent.remove();
      vi.unstubAllGlobals();
    }
  },
);
