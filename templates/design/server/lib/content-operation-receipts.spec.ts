import { describe, expect, it } from "vitest";

import {
  isOperationApplied,
  MAX_APPLIED_OPERATION_SOURCES,
  parseAppliedOperationRevisions,
  withAppliedOperationRevision,
  withLegacyOperationReceipt,
} from "./content-operation-receipts";

describe("parseAppliedOperationRevisions", () => {
  it("reads a stored map", () => {
    expect(parseAppliedOperationRevisions('{"tab-a":3,"tab-b":1}')).toEqual({
      "tab-a": 3,
      "tab-b": 1,
    });
  });

  it.each([null, undefined, "", "{}"])(
    "reads %j as a file with no receipts",
    (raw) => {
      expect(parseAppliedOperationRevisions(raw)).toEqual({});
    },
  );

  it.each([
    ["not json", "not json"],
    ["an array", "[1,2]"],
    ["a string", '"tab-a"'],
    ["a fractional revision", '{"tab-a":1.5}'],
    ["a negative revision", '{"tab-a":-1}'],
    ["a non-number revision", '{"tab-a":"3"}'],
  ])("reports %s as unreadable, not as empty", (_label, raw) => {
    expect(parseAppliedOperationRevisions(raw)).toBeNull();
  });
});

describe("isOperationApplied", () => {
  it("is true up to the newest applied revision and false after it", () => {
    const revisions = { "tab-a": 3 };
    expect(isOperationApplied(revisions, "tab-a", 1)).toBe(true);
    expect(isOperationApplied(revisions, "tab-a", 3)).toBe(true);
    expect(isOperationApplied(revisions, "tab-a", 4)).toBe(false);
  });

  it("is false for a session with no receipt", () => {
    expect(isOperationApplied({ "tab-a": 3 }, "tab-b", 1)).toBe(false);
  });
});

describe("withAppliedOperationRevision", () => {
  it("never lowers a session's revision", () => {
    expect(withAppliedOperationRevision({ "tab-a": 5 }, "tab-a", 2)).toEqual({
      "tab-a": 5,
    });
  });

  it("does not change the map it was given", () => {
    const revisions = { "tab-a": 1 };
    withAppliedOperationRevision(revisions, "tab-b", 1);
    expect(revisions).toEqual({ "tab-a": 1 });
  });

  it("keeps only the newest sessions and drops the oldest first", () => {
    let revisions: Record<string, number> = {};
    for (let index = 0; index < MAX_APPLIED_OPERATION_SOURCES + 2; index += 1) {
      revisions = withAppliedOperationRevision(revisions, `tab-${index}`, 1);
    }

    const sources = Object.keys(revisions);
    expect(sources).toHaveLength(MAX_APPLIED_OPERATION_SOURCES);
    expect(sources).not.toContain("tab-0");
    expect(sources).not.toContain("tab-1");
    expect(sources).toContain("tab-2");
    expect(sources).toContain(`tab-${MAX_APPLIED_OPERATION_SOURCES + 1}`);
  });

  it("counts a session that saves again as the newest", () => {
    let revisions: Record<string, number> = {};
    for (let index = 0; index < MAX_APPLIED_OPERATION_SOURCES; index += 1) {
      revisions = withAppliedOperationRevision(revisions, `tab-${index}`, 1);
    }
    revisions = withAppliedOperationRevision(revisions, "tab-0", 2);
    revisions = withAppliedOperationRevision(revisions, "tab-new", 1);

    expect(Object.keys(revisions)).toContain("tab-0");
    expect(Object.keys(revisions)).not.toContain("tab-1");
    expect(revisions["tab-0"]).toBe(2);
  });
});

describe("withLegacyOperationReceipt", () => {
  it("adds the scalar receipt of the last versioned writer", () => {
    expect(withLegacyOperationReceipt({ "tab-b": 1 }, "tab-a", 3)).toEqual({
      "tab-b": 1,
      "tab-a": 3,
    });
  });

  it("returns the same map when it already holds that receipt or a newer one", () => {
    const revisions = { "tab-a": 3 };
    expect(withLegacyOperationReceipt(revisions, "tab-a", 3)).toBe(revisions);
    expect(withLegacyOperationReceipt(revisions, "tab-a", 2)).toBe(revisions);
  });

  it.each([
    ["no session", null, 3],
    ["an empty session", "", 3],
    ["no revision", "tab-a", null],
    ["a zero revision", "tab-a", 0],
    ["a fractional revision", "tab-a", 1.5],
  ])("adds nothing for %s", (_label, source, revision) => {
    const revisions = { "tab-b": 1 };
    expect(withLegacyOperationReceipt(revisions, source, revision)).toBe(
      revisions,
    );
  });
});
