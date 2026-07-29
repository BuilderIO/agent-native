import { describe, expect, it } from "vitest";

import { designEditorRoute, isDesignEditorRoute } from "./design-editor-route";

describe("design editor routes", () => {
  it.each([
    ["/design/design_1", { designId: "design_1", surface: "design" }],
    ["/visual-edit/design_1", { designId: "design_1", surface: "visual-edit" }],
    [
      "/visual-edit/design%20one",
      { designId: "design one", surface: "visual-edit" },
    ],
  ])("classifies %s", (pathname, expected) => {
    expect(designEditorRoute(pathname)).toEqual(expected);
    expect(isDesignEditorRoute(pathname)).toBe(true);
  });

  it.each([
    "/design",
    "/visual-edit",
    "/visual-editing/design_1",
    "/visual-edit/%",
    "/",
  ])("does not classify %s as an editor route", (pathname) => {
    expect(designEditorRoute(pathname)).toBeNull();
    expect(isDesignEditorRoute(pathname)).toBe(false);
  });
});
