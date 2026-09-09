import { describe, expect, it } from "vitest";

import {
  contentDatabaseSourceFieldAllowsLocalWrite,
  contentDatabaseSourceFieldsAllowLocalWrite,
  parseContentDatabaseSourceFieldReadOnly,
  parseContentDatabaseSourceWriteOwner,
} from "./source-field-policy";

describe("Content source field write policy", () => {
  it("allows only explicit local ownership with an explicit writable flag", () => {
    expect(
      contentDatabaseSourceFieldAllowsLocalWrite({
        writeOwner: "local",
        readOnly: 0,
      }),
    ).toBe(true);
    expect(
      contentDatabaseSourceFieldAllowsLocalWrite({
        writeOwner: "local",
        readOnly: false,
      }),
    ).toBe(true);

    for (const field of [
      { writeOwner: "source", readOnly: 0 },
      { writeOwner: "derived", readOnly: 0 },
      { writeOwner: "local", readOnly: 1 },
      { writeOwner: "local", readOnly: true },
    ]) {
      expect(contentDatabaseSourceFieldAllowsLocalWrite(field)).toBe(false);
    }
  });

  it("rejects unknown ownership and read-only values instead of coercing them", () => {
    expect(() => parseContentDatabaseSourceWriteOwner("unknown")).toThrow(
      "Invalid Content source field write owner: unknown",
    );
    expect(() => parseContentDatabaseSourceWriteOwner(null)).toThrow(
      "Invalid Content source field write owner: null",
    );
    expect(() => parseContentDatabaseSourceFieldReadOnly(2)).toThrow(
      "Invalid Content source field read-only value: 2",
    );
    expect(() => parseContentDatabaseSourceFieldReadOnly(undefined)).toThrow(
      "Invalid Content source field read-only value: undefined",
    );
  });

  it("validates every mapped field before deciding the combined policy", () => {
    expect(() =>
      contentDatabaseSourceFieldsAllowLocalWrite([
        { writeOwner: "source", readOnly: 1 },
        { writeOwner: "unknown", readOnly: 0 },
      ]),
    ).toThrow("Invalid Content source field write owner: unknown");
  });
});
