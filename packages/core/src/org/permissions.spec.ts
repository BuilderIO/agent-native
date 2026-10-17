import { describe, expect, it } from "vitest";

import {
  canInviteOrgMembers,
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
