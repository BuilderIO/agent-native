import { describe, expect, it } from "vitest";

import { templateComposerReference } from "./template-composer-reference";

describe("templateComposerReference", () => {
  it("creates a composer reference for a global template", () => {
    const reference = templateComposerReference(
      {
        id: "global-template",
        libraryId: null,
        mediaType: "image",
        title: "Global template",
      },
      undefined,
    );

    expect(reference).toEqual(
      expect.objectContaining({
        refId: "global-template",
        metadata: { mediaType: "image" },
      }),
    );
    expect(reference?.relatedReferences).toBeUndefined();
  });

  it("adds Brand Kit requirements to an associated template", () => {
    const reference = templateComposerReference(
      {
        id: "associated-template",
        libraryId: "kit-a",
        mediaType: "image",
        title: "Associated template",
      },
      { id: "kit-a", title: "Brand A" },
    );

    expect(reference?.metadata).toMatchObject({
      libraryId: "kit-a",
      libraryTitle: "Brand A",
      requiredRefId: "kit-a",
      requiredSlotKey: "brand-kit",
    });
    expect(reference?.relatedReferences).toEqual([
      expect.objectContaining({ refId: "kit-a", refType: "brand-kit" }),
    ]);
  });

  it("waits for the associated Brand Kit before creating a reference", () => {
    expect(
      templateComposerReference(
        {
          id: "associated-template",
          libraryId: "kit-a",
          title: "Associated template",
        },
        undefined,
      ),
    ).toBeNull();
  });
});
