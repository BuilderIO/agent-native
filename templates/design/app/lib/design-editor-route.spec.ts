import { describe, expect, it } from "vitest";

import {
  designEditorRoute,
  isDesignEditorRoute,
  isPersistedDesignEditorRoute,
} from "./design-editor-route";

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
    expect(isPersistedDesignEditorRoute(pathname)).toBe(true);
  });

  it("keeps the Builder host shell out of persisted editor state", () => {
    expect(isDesignEditorRoute("/visual-edit/shell")).toBe(true);
    expect(isPersistedDesignEditorRoute("/visual-edit/shell")).toBe(false);
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
    expect(isPersistedDesignEditorRoute(pathname)).toBe(false);
  });
});
