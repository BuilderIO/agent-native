import { describe, expect, it } from "vitest";

import { dedupeCollabUsersByEmail } from "./types.js";

describe("dedupeCollabUsersByEmail", () => {
  it("ignores malformed awareness user payloads", () => {
    expect(
      dedupeCollabUsersByEmail([
        {
          name: "Broken",
          email: undefined as unknown as string,
          color: "#fff",
        },
        { name: "Real", email: "real@example.com", color: "#000" },
      ]),
    ).toEqual([{ name: "Real", email: "real@example.com", color: "#000" }]);
  });

  it("preserves valid avatars and ignores malformed avatar data", () => {
    expect(
      dedupeCollabUsersByEmail([
        {
          name: "Real",
          email: "REAL@example.com",
          color: "#000",
          avatarUrl: "https://example.com/real.jpg",
        },
      ]),
    ).toEqual([
      {
        name: "Real",
        email: "real@example.com",
        color: "#000",
        avatarUrl: "https://example.com/real.jpg",
      },
    ]);
    expect(
      dedupeCollabUsersByEmail([
        {
          name: "Broken",
          email: "broken@example.com",
          color: "#fff",
          avatarUrl: "  " as string,
        },
        {
          name: "Also broken",
          email: "also@example.com",
          color: "#000",
          avatarUrl: 42 as unknown as string,
        },
      ]),
    ).toEqual([
      { name: "Broken", email: "broken@example.com", color: "#fff" },
      { name: "Also broken", email: "also@example.com", color: "#000" },
    ]);
  });
});
