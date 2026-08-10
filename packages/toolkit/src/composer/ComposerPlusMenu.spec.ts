import { describe, expect, it } from "vitest";

import { isExtensionComposerMenuEnabled } from "./ComposerPlusMenu.js";

describe("isExtensionComposerMenuEnabled", () => {
  it("keeps extension creation out of the composer by default", () => {
    expect(isExtensionComposerMenuEnabled()).toBe(false);
    expect(isExtensionComposerMenuEnabled(false)).toBe(false);
  });

  it("allows hosts to opt into extension creation", () => {
    expect(isExtensionComposerMenuEnabled(true)).toBe(true);
  });
});
