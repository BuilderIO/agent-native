import { describe, expect, it } from "vitest";

import { assertUploadRecoveryIdentity } from "./upload-recovery-identity.js";
const current = { ownerEmail: "owner@example.com", orgId: "org-a" };
describe("upload recovery identity", () => {
  it.each([
    { expectedOwnerEmail: "other@example.com", expectedOrgId: "org-a" },
    { expectedOwnerEmail: "owner@example.com", expectedOrgId: "org-b" },
  ])(
    "refuses another principal or organization before upload state is touched",
    (expected) => {
      expect(() => assertUploadRecoveryIdentity(expected, current)).toThrow(
        expect.objectContaining({
          statusCode: 409,
          errorCode: "upload_identity_mismatch",
        }),
      );
    },
  );
  it("binds a normalized owner and requires an authenticated organization for scoped recovery", () => {
    expect(
      assertUploadRecoveryIdentity(
        { expectedOwnerEmail: "OWNER@EXAMPLE.COM", expectedOrgId: "org-a" },
        current,
      ),
    ).toMatchObject({
      expectedOwnerEmail: "owner@example.com",
      expectedOrgId: "org-a",
    });
    expect(() =>
      assertUploadRecoveryIdentity(
        { expectedOrgId: "org-a" },
        { ownerEmail: current.ownerEmail },
      ),
    ).toThrow(
      expect.objectContaining({ errorCode: "upload_identity_mismatch" }),
    );
  });
  it("refuses malformed present identities rather than dropping their checks", () => {
    expect(() =>
      assertUploadRecoveryIdentity(
        { expectedOwnerEmail: ["owner@example.com"] },
        current,
      ),
    ).toThrow(
      expect.objectContaining({
        statusCode: 400,
        errorCode: "upload_identity_invalid",
      }),
    );
  });
});
