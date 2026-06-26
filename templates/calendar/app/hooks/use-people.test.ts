import { describe, expect, it } from "vitest";

import { filterPeopleResults } from "./use-people";

describe("filterPeopleResults", () => {
  it("filters cached contacts locally and ranks prefix matches first", () => {
    const results = filterPeopleResults(
      [
        {
          name: "Project Alice",
          email: "project.alice@example.com",
          source: "otherContact",
        },
        {
          name: "Alice Example",
          email: "alice@example.com",
          source: "contact",
        },
        {
          name: "Bob Example",
          email: "bob@example.com",
          source: "contact",
        },
      ],
      "ali",
      new Set(),
    );

    expect(results.map((person) => person.email)).toEqual([
      "alice@example.com",
      "project.alice@example.com",
    ]);
  });

  it("omits already selected attendees", () => {
    const results = filterPeopleResults(
      [
        {
          name: "Alice Example",
          email: "alice@example.com",
          source: "contact",
        },
      ],
      "alice",
      new Set(["alice@example.com"]),
    );

    expect(results).toEqual([]);
  });
});
