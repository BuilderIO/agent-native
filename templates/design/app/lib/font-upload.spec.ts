import { describe, expect, it } from "vitest";

import { inferFontUploadMetadata } from "./font-upload";

describe("font upload metadata", () => {
  it("derives the family, weight, and style from common font filenames", () => {
    expect(inferFontUploadMetadata("Brand-Sans-SemiBold-Italic.woff2")).toEqual(
      {
        family: "Brand Sans",
        weight: "600",
        style: "italic",
      },
    );
  });
});
