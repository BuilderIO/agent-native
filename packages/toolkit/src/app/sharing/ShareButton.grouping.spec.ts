// Invite search splits results into "Already invited" and "Not invited to page". The two
// sides of the dialog name the same principal differently - a suggestion carries an email or
// a group id, a share carries a principal id - so the grouping rule is pinned here.
import { describe, expect, it } from "vitest";

import { groupSuggestionsByShareState } from "./ShareButton.js";

type Suggestion = Parameters<typeof groupSuggestionsByShareState>[0][number];
type Share = Parameters<typeof groupSuggestionsByShareState>[1][number];

const member = (email: string): Suggestion =>
  ({ email, name: email, principalType: "user" }) as Suggestion;
const group = (id: string): Suggestion =>
  ({ id, name: id, principalType: "group" }) as Suggestion;
const agent = (email: string): Suggestion =>
  ({ email, name: email, principalType: "agent" }) as Suggestion;
const share = (
  principalType: Share["principalType"],
  principalId: string,
  extra: Partial<Share> = {},
): Share =>
  ({
    id: principalId,
    principalType,
    principalId,
    role: "viewer",
    ...extra,
  }) as Share;

describe("groupSuggestionsByShareState", () => {
  it("splits members by whether the page already shares with them", () => {
    const groups = groupSuggestionsByShareState(
      [member("Ada@Example.test"), member("grace@example.test")],
      [share("user", "ada@example.test")],
    );
    expect(groups.map((entry) => entry.key)).toEqual(["already", "not"]);
    expect(groups[0]?.rows.map((row) => row.email)).toEqual([
      "Ada@Example.test",
    ]);
    expect(groups[1]?.rows.map((row) => row.email)).toEqual([
      "grace@example.test",
    ]);
  });

  it("keeps groups and agents apart from members, and reads org shares as no one", () => {
    const groups = groupSuggestionsByShareState(
      [group("grp_1"), agent("helper@agent.test"), member("ada@example.test")],
      [
        share("group", "grp_1"),
        share("user", "helper@agent.test", { agent: true }),
        share("org", "org_1"),
      ],
    );
    expect(groups.map((entry) => entry.key)).toEqual(["already", "not"]);
    expect(groups[0]?.rows.map((row) => row.name)).toEqual([
      "grp_1",
      "helper@agent.test",
    ]);
    expect(groups[1]?.rows.map((row) => row.email)).toEqual([
      "ada@example.test",
    ]);
  });

  it("drops an empty group instead of rendering a heading with nothing under it", () => {
    expect(
      groupSuggestionsByShareState(
        [member("ada@example.test")],
        [share("user", "ada@example.test")],
      ),
    ).toEqual([{ key: "already", rows: [member("ada@example.test")] }]);
    expect(groupSuggestionsByShareState([], [])).toEqual([]);
  });
});
