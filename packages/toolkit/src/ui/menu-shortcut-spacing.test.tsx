import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContextMenuShortcut } from "./context-menu.js";
import { DropdownMenuShortcut } from "./dropdown-menu.js";
import { MenubarShortcut } from "./menubar.js";

/**
 * The shortcut hint is pushed to the right edge with `ms-auto`, which
 * collapses to zero gap when the menu is only as wide as its widest row
 * (e.g. "Send backward" plus its shortcut in the Slides layer-order menu).
 * A fixed minimum padding keeps the label and shortcut from touching even
 * when the auto margin has no free space to distribute.
 */
describe("menu item shortcut spacing", () => {
  it.each([
    ["ContextMenuShortcut", ContextMenuShortcut],
    ["DropdownMenuShortcut", DropdownMenuShortcut],
    ["MenubarShortcut", MenubarShortcut],
  ] as const)(
    "%s reserves a minimum gap before the shortcut",
    (_name, Shortcut) => {
      const html = renderToStaticMarkup(<Shortcut>⌘↓</Shortcut>);

      expect(html).toContain("ms-auto");
      expect(html).toContain("ps-4");
    },
  );
});
