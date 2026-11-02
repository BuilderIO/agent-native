import { fail } from "@agent-native/core/action";
import { z } from "zod";

const expectedIdentitySchema = z.object({
  expectedOwnerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email())
    .optional(),
  expectedOrgId: z.string().trim().min(1).max(200).optional(),
});

export function assertUploadRecoveryIdentity(
  input: unknown,
  current: { ownerEmail: string; orgId?: string | undefined },
) {
  const parsed = expectedIdentitySchema.safeParse(input);
  if (!parsed.success)
    fail("The expected upload identity is invalid.", {
      errorCode: "upload_identity_invalid",
      statusCode: 400,
    });
  const expected = parsed.data;
  if (
    (expected.expectedOwnerEmail &&
      expected.expectedOwnerEmail !==
        current.ownerEmail.trim().toLowerCase()) ||
    (expected.expectedOrgId && expected.expectedOrgId !== current.orgId)
  )
    fail("The upload belongs to another account or organization.", {
      errorCode: "upload_identity_mismatch",
      statusCode: 409,
    });
  return expected;
}
