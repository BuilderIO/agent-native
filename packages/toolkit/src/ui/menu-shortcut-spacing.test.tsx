import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContextMenuShortcut } from "./context-menu.js";
import { DropdownMenuShortcut } from "./dropdown-menu.js";
import { MenubarShortcut } from "./menubar.js";

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
