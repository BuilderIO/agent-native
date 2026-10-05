import { describe, expect, it } from "vitest";

import { mergePresenceUsers } from "./presence-users";

const user = (email: string) => ({ name: email, email, color: "#000000" });

describe("mergePresenceUsers", () => {
  it("lists a person once when the screen and overview documents both report them", () => {
    const merged = mergePresenceUsers(
      [user("a@example.test")],
      [user("B@example.test")],
      [user("b@example.test"), user("c@example.test")],
    );
    expect(merged.map((u) => u.email)).toEqual([
      "a@example.test",
      "B@example.test",
      "c@example.test",
    ]);
  });

  it("tolerates a missing list", () => {
    expect(
      mergePresenceUsers(undefined, [user("a@example.test")]),
    ).toHaveLength(1);
  });
});
