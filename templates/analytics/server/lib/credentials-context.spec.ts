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
    getCredentialContext.mockReturnValue({
      userEmail: "admin@example.com",
      orgId: "customer-org",
    });
    const normalScope = credentialCacheScope(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    );

    getCredentialContext.mockReturnValue({
      userEmail: "admin@example.com",
      orgId: "customer-org",
      credentialScope: "org",
    });
    const orgOnlyScope = credentialCacheScope(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    );

    expect(normalScope).not.toBe(orgOnlyScope);
    expect(orgOnlyScope).toBe("o:customer-org:org");
    expect(
      scopedCredentialCacheKey("token", "GOOGLE_APPLICATION_CREDENTIALS_JSON"),
    ).toBe("o:customer-org:org:token");
  });
});
