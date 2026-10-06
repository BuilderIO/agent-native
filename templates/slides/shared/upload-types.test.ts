import { describe, expect, it } from "vitest";

import {
  SLIDES_REFERENCE_FILE_ACCEPT,
  isSlidesReferenceFileExtension,
} from "./upload-types";

describe("Slides upload types", () => {
  it("allows .fig files as reference uploads", () => {
    expect(isSlidesReferenceFileExtension(".fig")).toBe(true);
    expect(SLIDES_REFERENCE_FILE_ACCEPT.split(",")).toContain(".fig");
  });

  it("allows SVGs as reference uploads", () => {
    expect(isSlidesReferenceFileExtension(".svg")).toBe(true);
    expect(SLIDES_REFERENCE_FILE_ACCEPT.split(",")).toContain(".svg");
  });

  it("allows HTML references as text uploads", () => {
    expect(isSlidesReferenceFileExtension(".html")).toBe(true);
    expect(isSlidesReferenceFileExtension(".htm")).toBe(true);
    expect(SLIDES_REFERENCE_FILE_ACCEPT.split(",")).toContain(".html");
    expect(SLIDES_REFERENCE_FILE_ACCEPT.split(",")).toContain(".htm");
  });
});
