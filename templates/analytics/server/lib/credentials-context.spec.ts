import { beforeEach, describe, expect, it, vi } from "vitest";

const getCredentialContext = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({ getCredentialContext }));

import {
  credentialCacheScope,
  scopedCredentialCacheKey,
} from "./credentials-context";

describe("credential cache scope", () => {
  beforeEach(() => getCredentialContext.mockReset());

  it("separates org-only cache entries from the reviewer's normal org entries", () => {
    const normalScope = credentialCacheScope(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      {
        userEmail: "admin@example.com",
        orgId: "customer-org",
      },
    );
    const orgOnlyScope = credentialCacheScope(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      {
        userEmail: "admin@example.com",
        orgId: "customer-org",
        credentialScope: "org",
      },
    );

    expect(normalScope).not.toBe(orgOnlyScope);
    expect(orgOnlyScope).toBe("o:customer-org:org");
    getCredentialContext.mockReturnValue({
      userEmail: "admin@example.com",
      orgId: "customer-org",
      credentialScope: "org",
    });
    expect(
      scopedCredentialCacheKey("token", "GOOGLE_APPLICATION_CREDENTIALS_JSON"),
    ).toBe("o:customer-org:org:token");
  });

  it("isolates default credentials by member but shares org-only keys", () => {
    const memberA = credentialCacheScope(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      {
        userEmail: "member-a@example.com",
        orgId: "customer-org",
      },
    );
    const memberB = credentialCacheScope(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      {
        userEmail: "member-b@example.com",
        orgId: "customer-org",
      },
    );
    const adminA = credentialCacheScope("GOOGLE_APPLICATION_CREDENTIALS_JSON", {
      userEmail: "admin-a@example.com",
      orgId: "customer-org",
      credentialScope: "org",
    });
    const adminB = credentialCacheScope("GOOGLE_APPLICATION_CREDENTIALS_JSON", {
      userEmail: "admin-b@example.com",
      orgId: "customer-org",
      credentialScope: "org",
    });

    expect(memberA).not.toBe(memberB);
    expect(adminA).toBe(adminB);
    expect(adminA).not.toBe(memberA);
  });

  it("fails closed when org-only cache scope has no organization", () => {
    expect(() =>
      credentialCacheScope("GOOGLE_APPLICATION_CREDENTIALS_JSON", {
        userEmail: "admin@example.com",
        orgId: null,
        credentialScope: "org",
      }),
    ).toThrow("Org-only credential caches require an organization.");
  });
});
