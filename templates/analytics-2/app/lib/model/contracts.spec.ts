import { describe, expect, it } from "vitest";

import {
  PROJECT_TITLE_MAX_LENGTH,
  ProjectTitleTooLongError,
  normalizeProjectTitle,
} from "./contracts.js";

describe("project title contract", () => {
  it("matches the source 500-character limit", () => {
    expect(PROJECT_TITLE_MAX_LENGTH).toBe(500);
  });

  it("trims and preserves a title at the limit", () => {
    const exact = "b".repeat(500);
    expect(normalizeProjectTitle(`  ${exact}  `)).toBe(exact);
  });

  it("keeps titles longer than the old 255 truncation point", () => {
    const threeHundred = "d".repeat(300);
    expect(normalizeProjectTitle(threeHundred)).toBe(threeHundred);
  });

  it("rejects a title over the limit instead of truncating it", () => {
    expect(() => normalizeProjectTitle("c".repeat(501))).toThrow(
      ProjectTitleTooLongError,
    );
    expect(() => normalizeProjectTitle("c".repeat(501))).toThrow(
      /limited to 500 characters/,
    );
    try {
      normalizeProjectTitle("c".repeat(501));
    } catch (error) {
      expect(error).toMatchObject({
        code: "project_title_too_long",
        statusCode: 400,
      });
    }
  });
});
