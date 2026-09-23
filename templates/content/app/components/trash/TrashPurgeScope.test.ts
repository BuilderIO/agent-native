import { describe, expect, it } from "vitest";

import { trashPurgeScopeState } from "./TrashPurgeScope";

describe("Trash purge scope disclosure", () => {
  it("keeps confirmation closed while another page remains", () => {
    expect(
      trashPurgeScopeState({
        pageCount: 1,
        hasNextPage: true,
        fetching: false,
        failed: false,
      }),
    ).toEqual({ capped: false, shouldFetch: true, ready: false });
  });

  it("is ready only after every page is loaded", () => {
    expect(
      trashPurgeScopeState({
        pageCount: 3,
        hasNextPage: false,
        fetching: false,
        failed: false,
      }),
    ).toEqual({ capped: false, shouldFetch: false, ready: true });
  });

  it("fails closed at the safety cap", () => {
    expect(
      trashPurgeScopeState({
        pageCount: 100,
        hasNextPage: true,
        fetching: false,
        failed: false,
      }),
    ).toEqual({ capped: true, shouldFetch: false, ready: false });
  });

  it("does not fetch or enable confirmation after an error", () => {
    expect(
      trashPurgeScopeState({
        pageCount: 2,
        hasNextPage: true,
        fetching: false,
        failed: true,
      }),
    ).toEqual({ capped: false, shouldFetch: false, ready: false });
  });
});
