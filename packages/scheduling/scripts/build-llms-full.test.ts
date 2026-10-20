import path from "node:path";

import { describe, expect, it } from "vitest";

import { bundleEntries } from "./build-llms-full.mjs";

describe("bundleEntries", () => {
  it("writes the same headings, in the same order, from Windows paths", () => {
    const docsDir = "C:\\repo\\packages\\scheduling\\docs";
    const files = [
      `${docsDir}\\guide2.md`,
      `${docsDir}\\guide\\booking.md`,
      `${docsDir}\\llms.txt`,
    ];

    expect(
      bundleEntries(docsDir, files, path.win32).map((entry) => entry.rel),
    ).toEqual(["guide/booking.md", "guide2.md", "llms.txt"]);
  });
});
