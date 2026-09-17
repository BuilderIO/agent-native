import { describe, expect, it } from "vitest";

import { canInviteOrgMembers } from "./permissions.js";

describe("canInviteOrgMembers", () => {
  it("allows owners and admins when email delivery is configured", () => {
    expect(canInviteOrgMembers("owner", true)).toBe(true);
    expect(canInviteOrgMembers("admin", true)).toBe(true);
    expect(canInviteOrgMembers("admin")).toBe(true);
  });

  it("hides invitations when email delivery is unavailable", () => {
    expect(canInviteOrgMembers("owner", false)).toBe(false);
    expect(canInviteOrgMembers("admin", false)).toBe(false);
  });

  it("does not grant invitations to members", () => {
    expect(canInviteOrgMembers("member", true)).toBe(false);
    expect(canInviteOrgMembers(null, true)).toBe(false);
  });
});
