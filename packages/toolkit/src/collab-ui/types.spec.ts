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
});
