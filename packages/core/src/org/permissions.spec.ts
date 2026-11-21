import { describe, expect, it } from "vitest";

import {
  canInviteOrgMembers,
  canInviteOrgMembersUnderPolicy,
  canManageOrgA2ASecret,
  canManageOrgDomain,
} from "./permissions.js";

describe("canInviteOrgMembers", () => {
  it("allows owners and admins", () => {
    expect(canInviteOrgMembers("owner")).toBe(true);
    expect(canInviteOrgMembers("admin")).toBe(true);
  });

  it("does not grant invitations to members", () => {
    expect(canInviteOrgMembers("member")).toBe(false);
    expect(canInviteOrgMembers(null)).toBe(false);
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

describe("canInviteOrgMembersUnderPolicy", () => {
  const roles = ["owner", "admin", "member", null] as const;

  it("is admin-only in the default mode", () => {
    for (const role of roles) {
      expect(
        canInviteOrgMembersUnderPolicy(role, {
          mode: "admins",
          onlyAdminsCanInvite: false,
        }),
      ).toBe(canInviteOrgMembers(role));
    }
  });

  it("lets members invite in members mode but never a missing role", () => {
    const policy = { mode: "members", onlyAdminsCanInvite: false } as const;
    expect(canInviteOrgMembersUnderPolicy("member", policy)).toBe(true);
    expect(canInviteOrgMembersUnderPolicy("admin", policy)).toBe(true);
    expect(canInviteOrgMembersUnderPolicy(null, policy)).toBe(false);
    expect(canInviteOrgMembersUnderPolicy(undefined, policy)).toBe(false);
  });

  it("follows the org setting in org-setting mode", () => {
    expect(
      canInviteOrgMembersUnderPolicy("member", {
        mode: "org-setting",
        onlyAdminsCanInvite: false,
      }),
    ).toBe(true);
    expect(
      canInviteOrgMembersUnderPolicy("member", {
        mode: "org-setting",
        onlyAdminsCanInvite: true,
      }),
    ).toBe(false);
    expect(
      canInviteOrgMembersUnderPolicy("admin", {
        mode: "org-setting",
        onlyAdminsCanInvite: true,
      }),
    ).toBe(true);
  });

  it("never lets an unknown role inherit the opt-in", () => {
    for (const mode of ["members", "org-setting"] as const) {
      expect(
        canInviteOrgMembersUnderPolicy("guest" as never, {
          mode,
          onlyAdminsCanInvite: false,
        }),
      ).toBe(false);
    }
  });
});
