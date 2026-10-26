import { describe, expect, it } from "vitest";

import { screenIdForBackgroundContextMenu } from "./screen-context-menu";

const screens = new Set(["home", "board"]);

function menu(screenId: string, tagName: string | null) {
  return {
    type: "element-contextmenu",
    screenId,
    payload: tagName ? { tagName } : null,
  };
}

describe("screenIdForBackgroundContextMenu", () => {
  it("names the screen when the right-click landed on its root", () => {
    expect(
      screenIdForBackgroundContextMenu(menu("home", "BODY"), screens, "board"),
    ).toBe("home");
    expect(
      screenIdForBackgroundContextMenu(menu("home", "html"), screens, "board"),
    ).toBe("home");
  });

  it("leaves a right-click on a layer to the layer", () => {
    expect(
      screenIdForBackgroundContextMenu(menu("home", "DIV"), screens, "board"),
    ).toBeNull();
    expect(
      screenIdForBackgroundContextMenu(menu("home", null), screens, "board"),
    ).toBeNull();
  });

  it("ignores the board, unknown screens, and other messages", () => {
    expect(
      screenIdForBackgroundContextMenu(menu("board", "BODY"), screens, "board"),
    ).toBeNull();
    expect(
      screenIdForBackgroundContextMenu(menu("gone", "BODY"), screens, "board"),
    ).toBeNull();
    expect(
      screenIdForBackgroundContextMenu(
        {
          type: "element-select",
          screenId: "home",
          payload: { tagName: "BODY" },
        },
        screens,
        "board",
      ),
    ).toBeNull();
  });
});
