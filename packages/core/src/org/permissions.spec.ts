import { describe, expect, it } from "vitest";

import { canChangeOrgMemberRole, canRemoveOrgMember } from "./permissions.js";
import type { OrgRole } from "./types.js";

describe("organization member permissions", () => {
  it.each<
    [actorRole: OrgRole | null, memberRole: OrgRole | null, expected: boolean]
  >([
    ["owner", "owner", false],
    ["owner", "admin", true],
    ["owner", "member", true],
    ["admin", "admin", false],
    ["admin", "member", false],
    ["member", "member", false],
    [null, "member", false],
    ["owner", null, false],
  ])("%s changing a %s role is %s", (actorRole, memberRole, expected) => {
    expect(canChangeOrgMemberRole(actorRole, memberRole)).toBe(expected);
  });

  it.each<
    [actorRole: OrgRole | null, memberRole: OrgRole | null, expected: boolean]
  >([
    ["owner", "owner", false],
    ["owner", "admin", true],
    ["owner", "member", true],
    ["admin", "admin", false],
    ["admin", "member", true],
    ["member", "member", false],
    [null, "member", false],
    ["owner", null, false],
  ])("%s removing a %s is %s", (actorRole, memberRole, expected) => {
    expect(canRemoveOrgMember(actorRole, memberRole)).toBe(expected);
  });
});
