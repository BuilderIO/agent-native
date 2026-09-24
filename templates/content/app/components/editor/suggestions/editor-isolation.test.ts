import { describe, expect, it } from "vitest";

import { suggestedEditorIsolation } from "./editor-isolation";

describe("suggestedEditorIsolation", () => {
  it("never binds or saves canonical state while suggesting", () => {
    expect(
      suggestedEditorIsolation({
        suggesting: true,
        canSuggest: true,
        canEdit: true,
        collaborationReady: true,
      }),
    ).toEqual({
      editable: true,
      bindCanonicalYDoc: false,
      persistCanonical: false,
    });
  });

  it("lets a commenter use the isolated editor without direct edit rights", () => {
    expect(
      suggestedEditorIsolation({
        suggesting: true,
        canSuggest: true,
        canEdit: false,
        collaborationReady: false,
      }).editable,
    ).toBe(true);
  });
});
