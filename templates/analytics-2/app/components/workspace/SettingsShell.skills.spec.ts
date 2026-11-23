import { describe, expect, it } from "vitest";

import { NAV_GROUPS } from "./SettingsShell";

/**
 * Skills is a personal surface: the reference lets a member manage their own
 * skills from Settings, not only through search (tester rows 208-210). The rail
 * hides any group marked adminOnly for a member, so the item must live in a
 * group that is not adminOnly, or a member never sees it.
 */
describe("settings navigation visibility for members", () => {
  const groupsForMember = NAV_GROUPS.filter((group) => !group.adminOnly);

  it("shows the Skills item to a member", () => {
    const skills = groupsForMember
      .flatMap((group) => group.items)
      .find((item) => item.tab === "skills");
    expect(
      skills,
      "Skills must be reachable from Settings for a member",
    ).toBeDefined();
    expect(skills?.label).toBe("Skills");
  });

  it("keeps administrative pages out of the member navigation", () => {
    const memberTabs = groupsForMember.flatMap((group) =>
      group.items.map((item) => item.tab),
    );
    for (const adminTab of [
      "organization",
      "users",
      "secrets",
      "trusted-mode",
    ]) {
      expect(memberTabs).not.toContain(adminTab);
    }
  });
});
