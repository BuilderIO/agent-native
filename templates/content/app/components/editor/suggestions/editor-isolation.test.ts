import { describe, expect, it } from "vitest";

import { suggestedEditorIsolation } from "./editor-isolation";

const timestamps = {
  canonicalUpdatedAt: "2026-10-05T12:00:05.000Z",
  draftUpdatedAt: "2026-10-05T12:00:00.000Z",
};

describe("suggestedEditorIsolation", () => {
  it("never binds, reconciles, or saves canonical state while suggesting", () => {
    expect(
      suggestedEditorIsolation({
        suggesting: true,
        canSuggest: true,
        canEdit: true,
        collaborationReady: true,
        ...timestamps,
      }),
    ).toEqual({
      editable: true,
      bindCanonicalYDoc: false,
      persistCanonical: false,
      reconcileCanonical: false,
      contentUpdatedAt: timestamps.draftUpdatedAt,
    });
  });

  it("follows the canonical Page outside Suggesting mode", () => {
    expect(
      suggestedEditorIsolation({
        suggesting: false,
        canSuggest: true,
        canEdit: true,
        collaborationReady: true,
        ...timestamps,
      }).contentUpdatedAt,
    ).toBe(timestamps.canonicalUpdatedAt);
  });

  it("lets a commenter use the isolated editor without direct edit rights", () => {
    expect(
      suggestedEditorIsolation({
        suggesting: true,
        canSuggest: true,
        canEdit: false,
        collaborationReady: false,
        ...timestamps,
      }).editable,
    ).toBe(true);
  });
});
