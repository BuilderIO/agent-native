import { describe, expect, it } from "vitest";

import { CHATGPT_DIRECTORY_PROFILE } from "./chatgpt-directory-tools.js";

describe("Design ChatGPT directory widget targets", () => {
  it("opens generated output focused on its first renderable screen", () => {
    const target = CHATGPT_DIRECTORY_PROFILE.widgetTargets["generate-design"](
      { designId: "design-1" },
      {
        designId: "design-1",
        urlPath: "/design/design-1?editorView=overview&screen=screen%2Fdesktop",
      },
    );

    expect(target).toMatchObject({
      targetPath:
        "/design/design-1?editorView=overview&screen=screen%2Fdesktop",
      resourceIds: { designId: "design-1" },
      writeActions: ["create-file", "update-design", "update-file"],
    });
  });

  it("falls back to the design canvas when no generated screen is in the result", () => {
    const target = CHATGPT_DIRECTORY_PROFILE.widgetTargets["generate-design"](
      { designId: "design-1" },
      { designId: "design-1", urlPath: "/design/design-1" },
    );

    expect(target).toMatchObject({
      targetPath: "/design/design-1",
      resourceIds: { designId: "design-1" },
    });
  });

  it("does not focus a screen from a different design route", () => {
    const target = CHATGPT_DIRECTORY_PROFILE.widgetTargets["generate-design"](
      { designId: "design-1" },
      {
        designId: "design-1",
        urlPath: "/design/other-design?editorView=overview&screen=screen-2",
      },
    );

    expect(target).toMatchObject({ targetPath: "/design/design-1" });
  });
});
