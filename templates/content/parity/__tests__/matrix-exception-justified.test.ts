import { describe, expect, it } from "vitest";

import { parityMatrix } from "../matrix";

const statusesRequiringException = new Set([
  "action-equivalent",
  "host-only",
  "missing",
  "route-backed-gap",
]);

const statusesRequiringFollowUp = new Set(["missing", "route-backed-gap"]);

describe("Content parity matrix exception discipline", () => {
  it("justifies statuses that are not direct action-backed or purely client-local", () => {
    const missingException = parityMatrix
      .filter((row) => statusesRequiringException.has(row.status))
      .filter((row) => !row.exception?.trim())
      .map((row) => row.id);

    expect(missingException).toEqual([]);
  });

  it("links gaps to a follow-up PR scope", () => {
    const missingFollowUp = parityMatrix
      .filter((row) => statusesRequiringFollowUp.has(row.status))
      .filter((row) => !row.followUpPR?.trim())
      .map((row) => row.id);

    expect(missingFollowUp).toEqual([]);
  });

  it("keeps row ids stable and unique", () => {
    const ids = parityMatrix.map((row) => row.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    const unstable = ids.filter(
      (id) => !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id),
    );

    expect(duplicates).toEqual([]);
    expect(unstable).toEqual([]);
  });
});
