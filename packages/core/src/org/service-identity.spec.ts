import { describe, expect, it } from "vitest";

import { serviceIdentityEmail } from "../mcp/connect-store.js";
import {
  implicitServiceOrgRole,
  parseServiceIdentityEmail,
} from "./service-identity.js";

describe("parseServiceIdentityEmail", () => {
  it("round-trips an email built by serviceIdentityEmail", () => {
    expect(
      parseServiceIdentityEmail(serviceIdentityEmail("pr-recap", "org-1")),
    ).toEqual({ serviceName: "pr-recap", orgId: "org-1" });
  });

  it("keeps org ids containing hyphens and dots intact", () => {
    expect(parseServiceIdentityEmail("svc-ci@service.org-abc.def-1")).toEqual({
      serviceName: "ci",
      orgId: "org-abc.def-1",
    });
  });

  it("preserves the original casing of the org id", () => {
    expect(parseServiceIdentityEmail("svc-ci@service.Org-Abc")?.orgId).toBe(
      "Org-Abc",
    );
  });

  it("rejects addresses that are not service identities", () => {
    expect(parseServiceIdentityEmail("alexander@builder.io")).toBeNull();
    expect(parseServiceIdentityEmail("")).toBeNull();
    expect(parseServiceIdentityEmail(undefined)).toBeNull();
    expect(parseServiceIdentityEmail(null)).toBeNull();
    expect(parseServiceIdentityEmail("svc-@service.org-1")).toBeNull();
    expect(parseServiceIdentityEmail("svcx@service.org-1")).toBeNull();
    expect(parseServiceIdentityEmail("svc-ci@service.")).toBeNull();
  });
});

describe("implicitServiceOrgRole", () => {
  it("grants member to a service identity acting for its own org", () => {
    expect(
      implicitServiceOrgRole({
        email: "svc-support-bot@service.org-1",
        orgId: "org-1",
        requestOrgId: "org-1",
      }),
    ).toBe("member");
  });

  it("denies a service identity minted for a different org", () => {
    expect(
      implicitServiceOrgRole({
        email: "svc-support-bot@service.org-2",
        orgId: "org-1",
        requestOrgId: "org-1",
      }),
    ).toBeNull();
  });

  it("denies when the request org id does not corroborate the target org", () => {
    expect(
      implicitServiceOrgRole({
        email: "svc-support-bot@service.org-1",
        orgId: "org-1",
        requestOrgId: null,
      }),
    ).toBeNull();
    expect(
      implicitServiceOrgRole({
        email: "svc-support-bot@service.org-1",
        orgId: "org-1",
        requestOrgId: "org-2",
      }),
    ).toBeNull();
  });

  it("denies a human account even when both org ids agree", () => {
    expect(
      implicitServiceOrgRole({
        email: "alexander@builder.io",
        orgId: "org-1",
        requestOrgId: "org-1",
      }),
    ).toBeNull();
  });

  it("denies when no target org is supplied", () => {
    expect(
      implicitServiceOrgRole({
        email: "svc-support-bot@service.org-1",
        orgId: null,
        requestOrgId: "org-1",
      }),
    ).toBeNull();
  });
});
