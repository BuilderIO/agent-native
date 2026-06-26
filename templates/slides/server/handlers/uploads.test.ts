import { describe, expect, it } from "vitest";

import {
  MAX_FIG_REFERENCE_FILE_BYTES,
  MAX_REFERENCE_FILE_BYTES,
  maxReferenceFileBytes,
} from "./uploads";

describe("Slides reference upload limits", () => {
  it("allows larger Figma local-copy files than ordinary references", () => {
    expect(maxReferenceFileBytes("brand.fig")).toBe(
      MAX_FIG_REFERENCE_FILE_BYTES,
    );
    expect(maxReferenceFileBytes("deck.pdf")).toBe(MAX_REFERENCE_FILE_BYTES);
    expect(maxReferenceFileBytes(undefined)).toBe(MAX_REFERENCE_FILE_BYTES);
  });
});
