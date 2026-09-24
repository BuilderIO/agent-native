import { describe, expect, it } from "vitest";

import { SlidesComposerContextSchema } from "./composer-context.js";
import { resolveDeckDesignSystemReference } from "./deck-content.js";

describe("deck design-system reference compatibility", () => {
  const reference = {
    id: "foreign-brand",
    ownerApp: "design" as const,
    consumedRevision: 2,
  };
  it("retains the canonical reference in composer schema and resolves historical composer-only data", () => {
    const composerContext = SlidesComposerContextSchema.parse({
      designSystemId: null,
      designSystemRef: reference,
      references: [],
    });
    expect(composerContext.designSystemRef).toEqual(reference);
    expect(resolveDeckDesignSystemReference({ composerContext })).toEqual(
      reference,
    );
  });
  it("honors a top-level clear or replacement instead of resurrecting an old composer ref", () => {
    expect(
      resolveDeckDesignSystemReference({
        designSystemRef: null,
        composerContext: { designSystemRef: reference },
      }),
    ).toBeNull();
    expect(
      resolveDeckDesignSystemReference({
        designSystemRef: { ...reference, consumedRevision: 3 },
        composerContext: { designSystemRef: reference },
      }),
    ).toMatchObject({ consumedRevision: 3 });
    expect(() =>
      resolveDeckDesignSystemReference({ designSystemRef: { id: "invalid" } }),
    ).toThrow();
  });
});
