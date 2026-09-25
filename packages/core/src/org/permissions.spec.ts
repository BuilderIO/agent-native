import { describe, expect, it } from "vitest";

import {
  canInviteOrgMembers,
  canManageOrgA2ASecret,
  canManageOrgDomain,
} from "./permissions.js";

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

describe("canManageOrgDomain", () => {
  it("lets owners and admins manage email domain auto-join", () => {
    expect(canManageOrgDomain("owner")).toBe(true);
    expect(canManageOrgDomain("admin")).toBe(true);
  });

  it("does not let members manage it", () => {
    expect(canManageOrgDomain("member")).toBe(false);
    expect(canManageOrgDomain(null)).toBe(false);
  });
});

describe("canManageOrgA2ASecret", () => {
  it("keeps the cross-app secret with the owner", () => {
    expect(canManageOrgA2ASecret("owner")).toBe(true);
    expect(canManageOrgA2ASecret("admin")).toBe(false);
    expect(canManageOrgA2ASecret("member")).toBe(false);
    expect(canManageOrgA2ASecret(undefined)).toBe(false);
  });
});
