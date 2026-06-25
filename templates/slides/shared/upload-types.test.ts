import { describe, expect, it } from "vitest";

import {
  SLIDES_REFERENCE_FILE_ACCEPT,
  isSlidesReferenceFileExtension,
} from "./upload-types";

describe("Slides upload types", () => {
  it("allows Figma local-copy files as reference uploads", () => {
    expect(isSlidesReferenceFileExtension(".fig")).toBe(true);
    expect(SLIDES_REFERENCE_FILE_ACCEPT.split(",")).toContain(".fig");
  });

  it("allows SVGs as reference uploads", () => {
    expect(isSlidesReferenceFileExtension(".svg")).toBe(true);
    expect(SLIDES_REFERENCE_FILE_ACCEPT.split(",")).toContain(".svg");
  });
});
