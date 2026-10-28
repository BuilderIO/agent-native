import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContextMenuShortcut } from "./context-menu.js";
import { DropdownMenuShortcut, DropdownMenuTrailing } from "./dropdown-menu.js";
import { MenubarShortcut } from "./menubar.js";

describe("menu item shortcut spacing", () => {
  it.each([
    ["ContextMenuShortcut", ContextMenuShortcut],
    ["MenubarShortcut", MenubarShortcut],
  ] as const)(
    "%s reserves a minimum gap before the shortcut",
    (_name, Shortcut) => {
      const html = renderToStaticMarkup(<Shortcut>⌘↓</Shortcut>);

      expect(html).toContain("ms-auto");
      expect(html).toContain("ps-4");
    },
  );

  it("gives DropdownMenuShortcut the shared trailing slot", () => {
    const html = renderToStaticMarkup(
      <DropdownMenuShortcut>⌘↓</DropdownMenuShortcut>,
    );
    expect(html).toContain("ms-auto");
    expect(html).toContain("min-w-4");
    expect(html).toContain("justify-center");
    expect(html).not.toContain("ps-4");
  });

  it("puts the submenu chevron and trailing icons in the same slot", () => {
    const trailing = renderToStaticMarkup(
      <DropdownMenuTrailing>x</DropdownMenuTrailing>,
    );
    expect(trailing).toContain("ms-auto");
    expect(trailing).toContain("size-4");
    expect(trailing).toContain("justify-center");
  });
});
