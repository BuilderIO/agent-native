import { describe, expect, it } from "vitest";

import { publishAction } from "./EditorHeader";

describe("publishAction", () => {
  it("offers Publish on a draft", () => {
    expect(publishAction({ status: "draft" }, false)).toEqual({
      label: "publish",
      enabled: true,
    });
  });

  it("says Published and stops offering it once the form is live and clean", () => {
    expect(publishAction({ status: "published" }, false)).toEqual({
      label: "published",
      enabled: false,
    });
  });

  it("offers Publish changes while a live form has unpublished edits", () => {
    expect(publishAction({ status: "published" }, true)).toEqual({
      label: "publishChanges",
      enabled: true,
    });
  });
});
