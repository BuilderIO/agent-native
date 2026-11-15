import { describe, expect, it } from "vitest";

import { canManageStorage } from "./use-can-manage-storage";

type Org = Parameters<typeof canManageStorage>[0];

function org(fields: Partial<NonNullable<Org>> = {}): Org {
  return {
    email: "saee@example.com",
    orgId: null,
    orgName: null,
    role: null,
    ...fields,
  } as Org;
}

describe("canManageStorage", () => {
  it("lets organization owners and admins open storage settings", () => {
    expect(canManageStorage(org({ orgId: "org-1", role: "admin" }), true)).toBe(
      true,
    );
  });

  it("sends organization members to the fixes they can make", () => {
    expect(
      canManageStorage(org({ orgId: "org-1", role: "member" }), false),
    ).toBe(false);
  });

  it("sends a viewer with no organization on a shared deployment to those fixes too", () => {
    expect(canManageStorage(org({ soloDeploymentAdmin: false }), false)).toBe(
      false,
    );
    expect(canManageStorage(org(), false)).toBe(false);
  });

  it("lets the only admin of a self-hosted deployment open storage settings", () => {
    expect(canManageStorage(org({ soloDeploymentAdmin: true }), false)).toBe(
      true,
    );
  });

  it("offers no settings button while the organization is loading", () => {
    expect(canManageStorage(undefined, false)).toBe(false);
  });
});
