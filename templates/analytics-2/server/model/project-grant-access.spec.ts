import { describe, expect, it } from "vitest";

import {
  canEditProject,
  canManageProject,
  canReadProject,
  resolveProjectAccess,
  type ProjectGrant,
} from "./project-grant-access";

const base = {
  ownerEmail: "owner@example.test",
  viewerEmail: "member@example.test",
  viewerOrgId: "org-1",
  projectOrgId: "org-1",
};

const grant = (over: Partial<ProjectGrant>): ProjectGrant => ({
  principalType: "user",
  principalId: "member@example.test",
  role: "viewer",
  ...over,
});

describe("project grant access", () => {
  it("keeps the owner at full access whatever the grants say", () => {
    expect(
      resolveProjectAccess({
        ...base,
        viewerEmail: "OWNER@example.test",
        grants: [],
      }),
    ).toBe("owner");
    expect(canManageProject("owner")).toBe(true);
  });

  // oracle-change: sharing is a core capability; access is determined by grants.
  it("maps share roles to read, edit and manage", () => {
    const level = (role: string) =>
      resolveProjectAccess({ ...base, grants: [grant({ role })] });
    expect(level("viewer")).toBe("read");
    expect(level("commenter")).toBe("read");
    expect(level("editor")).toBe("edit");
    expect(level("admin")).toBe("manage");
    expect(canEditProject(level("viewer"))).toBe(false);
    expect(canEditProject(level("editor"))).toBe(true);
    expect(canManageProject(level("editor"))).toBe(false);
    expect(canReadProject(level("viewer"))).toBe(true);
  });

  it("takes the strongest matching grant", () => {
    expect(
      resolveProjectAccess({
        ...base,
        grants: [
          grant({ role: "viewer" }),
          grant({ role: "editor", principalId: "member@example.test" }),
        ],
      }),
    ).toBe("edit");
  });

  it("counts a workspace grant and a group the viewer belongs to", () => {
    expect(
      resolveProjectAccess({
        ...base,
        grants: [
          grant({ principalType: "org", principalId: "org-1", role: "viewer" }),
        ],
      }),
    ).toBe("read");
    expect(
      resolveProjectAccess({
        ...base,
        sharedGroups: ["analysts"],
        grants: [
          grant({
            principalType: "group",
            principalId: "analysts",
            role: "editor",
          }),
        ],
      }),
    ).toBe("edit");
  });

  it("refuses grants from another workspace and unknown roles", () => {
    expect(
      resolveProjectAccess({
        ...base,
        viewerOrgId: "org-2",
        grants: [grant({})],
      }),
    ).toBeNull();
    expect(
      resolveProjectAccess({ ...base, grants: [grant({ role: "superuser" })] }),
    ).toBeNull();
    expect(
      resolveProjectAccess({ ...base, grants: [grant({})], viewerEmail: "" }),
    ).toBeNull();
  });

  it("lets a direct grant open the project only while a workspace invite is pending", () => {
    const invitee = {
      ...base,
      viewerOrgId: "org-2",
      grants: [grant({ role: "editor" })],
    };
    expect(resolveProjectAccess(invitee)).toBeNull();
    expect(
      resolveProjectAccess({ ...invitee, viewerHasPendingInvite: true }),
    ).toBe("edit");
    expect(
      resolveProjectAccess({
        ...invitee,
        viewerHasPendingInvite: true,
        grants: [grant({ role: "viewer" })],
      }),
    ).toBe("read");
  });

  it("never widens a pending invitee to org grants, groups or org visibility", () => {
    expect(
      resolveProjectAccess({
        ...base,
        viewerOrgId: "org-2",
        viewerHasPendingInvite: true,
        visibility: "org",
        sharedGroups: ["g"],
        grants: [
          grant({ principalType: "org", principalId: "org-1" }),
          grant({ principalType: "group", principalId: "g" }),
        ],
      }),
    ).toBeNull();
  });
});
