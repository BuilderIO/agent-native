// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  LAST_LOCATION_HINT_STORAGE_KEY,
  readLastLocationHint,
  readLastLocationHintForAnyAccount,
  rememberLastLocationHint,
} from "./last-location-hint";

const alice = JSON.stringify(["alice@example.com", "org-1"]);
const bob = JSON.stringify(["bob@example.com", "org-1"]);

describe("last location hint", () => {
  beforeEach(() => localStorage.clear());

  it("returns the page this person last opened in this organization", () => {
    expect(readLastLocationHint(alice)).toBeNull();
    rememberLastLocationHint(alice, "page-1");
    rememberLastLocationHint(alice, "page-2");

    expect(readLastLocationHint(alice)).toBe("page-2");
    expect(readLastLocationHint(bob)).toBeNull();
    expect(readLastLocationHint(null)).toBeNull();
  });

  it("names the last page before anyone is known to be signed in", () => {
    expect(readLastLocationHintForAnyAccount()).toBeNull();
    rememberLastLocationHint(bob, "page-3");
    expect(readLastLocationHintForAnyAccount()).toBe("page-3");
  });

  it("keeps only the page id", () => {
    rememberLastLocationHint(alice, "page-1");
    expect(
      JSON.parse(localStorage.getItem(LAST_LOCATION_HINT_STORAGE_KEY)!),
    ).toEqual({ scope: alice, documentId: "page-1" });
  });

  it("ignores a malformed hint", () => {
    localStorage.setItem(LAST_LOCATION_HINT_STORAGE_KEY, "not json");
    expect(readLastLocationHint(alice)).toBeNull();
    localStorage.setItem(
      LAST_LOCATION_HINT_STORAGE_KEY,
      JSON.stringify({ scope: alice, documentId: 42 }),
    );
    expect(readLastLocationHint(alice)).toBeNull();
  });
});
