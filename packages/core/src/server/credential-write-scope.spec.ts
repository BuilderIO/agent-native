import { describe, expect, it } from "vitest";

import {
  decideCredentialWriteScope,
  type CredentialWriteAction,
  type CredentialWriteDecision,
  type CredentialWriteScope,
} from "./credential-write-scope.js";

type Row = [
  role: "owner" | "admin" | "member" | null,
  action: CredentialWriteAction,
  requested: CredentialWriteScope | null,
  expected: CredentialWriteDecision,
];

const org = { scope: "org" } as const;
const personal = { scope: "personal" } as const;
const refuse = (refusal: string) => ({ refuse: refusal });

describe("decideCredentialWriteScope (role x action)", () => {
  // Org has no Builder connection yet; personal keys allowed.
  const rows: Row[] = [
    ["owner", "connect", null, org],
    ["admin", "connect", null, org],
    ["member", "connect", null, personal],
    ["owner", "connect", "org", org],
    ["member", "connect", "org", refuse("org_admin_required")],
    ["owner", "connect", "personal", refuse("managers_write_for_org")],
    ["member", "connect", "personal", personal],
    // Org by default: a first-run owner's new account powers the workspace.
    ["owner", "activate", null, org],
    ["admin", "activate", "org", org],
    ["member", "activate", null, personal],
    ["member", "activate", "org", refuse("org_admin_required")],
    ["admin", "activate", "personal", refuse("managers_write_for_org")],
  ];

  it.each(rows)("%s %s (%s)", (role, action, requestedScope, expected) => {
    expect(
      decideCredentialWriteScope({
        action,
        role,
        orgId: "org-1",
        requestedScope,
        personalAllowed: true,
        orgConnected: false,
      }),
    ).toEqual(expected);
  });

  it("never lets an activation replace or shadow an existing org connection", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      for (const requestedScope of [null, "org"] as const) {
        const decision = decideCredentialWriteScope({
          action: "activate",
          role,
          orgId: "org-1",
          requestedScope,
          personalAllowed: true,
          orgConnected: true,
        });
        // Owners and admins reconnect the org's account by logging in to it.
        expect(decision, `${role} ${requestedScope}`).toEqual(
          refuse(
            role === "member"
              ? requestedScope === "org"
                ? "org_admin_required"
                : "org_already_connected"
              : "org_reconnect_by_login",
          ),
        );
      }
    }
    // A member who names a personal account on purpose may still have one.
    expect(
      decideCredentialWriteScope({
        action: "activate",
        role: "member",
        orgId: "org-1",
        requestedScope: "personal",
        personalAllowed: true,
        orgConnected: true,
      }),
    ).toEqual(personal);
  });

  it("keeps a reconnect of the org connection open to owners and admins", () => {
    expect(
      decideCredentialWriteScope({
        action: "connect",
        role: "admin",
        orgId: "org-1",
        requestedScope: "org",
        personalAllowed: true,
        orgConnected: true,
      }),
    ).toEqual(org);
  });

  it("refuses a personal write the org's policy restricts", () => {
    for (const action of ["connect", "activate"] as const) {
      expect(
        decideCredentialWriteScope({
          action,
          role: "member",
          orgId: "org-1",
          requestedScope: null,
          personalAllowed: false,
          orgConnected: false,
        }),
      ).toEqual(refuse("personal_restricted"));
    }
  });

  it("writes personally without an organization, whatever the role says", () => {
    for (const action of ["connect", "activate"] as const) {
      expect(
        decideCredentialWriteScope({
          action,
          role: "owner",
          orgId: null,
          requestedScope: null,
          personalAllowed: true,
        }),
      ).toEqual(personal);
    }
  });
});
