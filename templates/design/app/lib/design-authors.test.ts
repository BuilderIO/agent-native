import { describe, expect, it } from "vitest";

import {
  ALL_AUTHORS,
  collectAuthorEmails,
  filterDesignsByAuthor,
  MY_DESIGNS,
  shouldShowAuthors,
} from "./design-authors";

const designs = [
  { id: "a", ownerEmail: "zoe@example.com" },
  { id: "b", ownerEmail: "adam@example.com" },
  { id: "c", ownerEmail: "Zoe@Example.com" },
  { id: "d", ownerEmail: null },
];

describe("collectAuthorEmails", () => {
  it("dedupes case variants of one author and orders by display name", () => {
    expect(collectAuthorEmails(designs)).toEqual([
      "adam@example.com",
      "zoe@example.com",
    ]);
  });

  it("returns no authors when nothing records an owner", () => {
    expect(collectAuthorEmails([{ ownerEmail: null }, {}])).toEqual([]);
  });
});

describe("shouldShowAuthors", () => {
  it("stays hidden for a solo workspace with one author", () => {
    expect(
      shouldShowAuthors({
        orgMemberCount: 1,
        authorEmails: ["solo@example.com"],
      }),
    ).toBe(false);
  });

  it("shows for a team whose designs all belong to one member", () => {
    expect(
      shouldShowAuthors({
        orgMemberCount: 4,
        authorEmails: ["solo@example.com"],
      }),
    ).toBe(true);
  });

  it("shows when a second author appears without any org", () => {
    expect(
      shouldShowAuthors({
        orgMemberCount: undefined,
        authorEmails: ["a@example.com", "b@example.com"],
      }),
    ).toBe(true);
  });
});

describe("filterDesignsByAuthor", () => {
  it("keeps every design for the all-authors value", () => {
    expect(
      filterDesignsByAuthor(designs, ALL_AUTHORS, "zoe@example.com"),
    ).toEqual(designs);
  });

  it("matches one author regardless of stored email casing", () => {
    expect(
      filterDesignsByAuthor(designs, "zoe@example.com", null).map((d) => d.id),
    ).toEqual(["a", "c"]);
  });

  it("resolves the mine value against the viewer email", () => {
    expect(
      filterDesignsByAuthor(designs, MY_DESIGNS, " Adam@example.com ").map(
        (d) => d.id,
      ),
    ).toEqual(["b"]);
  });

  it("returns nothing for mine when the viewer is unknown", () => {
    expect(filterDesignsByAuthor(designs, MY_DESIGNS, null)).toEqual([]);
  });
});
