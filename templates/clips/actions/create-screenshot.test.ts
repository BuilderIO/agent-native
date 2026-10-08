import { describe, expect, it } from "vitest";

import { createScreenshotSchema } from "./create-screenshot";

const VALID = {
  dataUrl: "data:image/jpeg;base64,/9j/4AAQ",
  width: 2560,
  height: 1440,
};

describe("create-screenshot schema", () => {
  it("requires the captured pixel size", () => {
    // Without dimensions the library grid cannot lay the card out, and a
    // zero-sized image is always a failed capture rather than a real one.
    expect(
      createScreenshotSchema.safeParse({ dataUrl: VALID.dataUrl }).success,
    ).toBe(false);
    expect(
      createScreenshotSchema.safeParse({ ...VALID, width: 0 }).success,
    ).toBe(false);
  });

  it("accepts dimensions as strings so CLI callers work", () => {
    const parsed = createScreenshotSchema.parse({
      ...VALID,
      width: "1920",
      height: "1080",
    });

    expect(parsed.width).toBe(1920);
    expect(parsed.height).toBe(1080);
  });

  it("leaves visibility unset so the organization default can apply", () => {
    expect(createScreenshotSchema.parse(VALID).visibility).toBeUndefined();
  });

  it("takes an optional folder and spaces, like a recording", () => {
    const parsed = createScreenshotSchema.safeParse({
      ...VALID,
      title: "Checkout page",
      folderId: "folder-1",
      spaceIds: ["space-1"],
    });

    expect(parsed.success).toBe(true);
  });
});
