import { createHash } from "node:crypto";

import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { canManageOrg } from "../../org/permissions.js";
import { isTrustedSelfHostedRuntime } from "../../server/credential-provider.js";
import {
  getActiveGoogleSignInCredentials,
  resolveGoogleLegacyProviderCredentials,
  resolveGoogleProviderCredentials,
  resolveGoogleSignInCredentials,
} from "../../server/google-oauth-credentials.js";
import {
  getInfrastructureStatus,
  infrastructureStatusOutputSchema,
} from "../../server/infrastructure-status.js";
import { readOrgMemberRole } from "../../server/personal-provider-key-policy.js";

export const INFRASTRUCTURE_ADMIN_REQUIRED_ERROR_CODE =
  "infrastructure_admin_required";

const credentialFingerprintSchema = z.object({
  clientId: z.string(),
  secretSha256: z.string().length(64),
  secretLast4: z.string().min(1).max(4).nullable(),
});

const googleCredentialFingerprintsSchema = z.object({
  activeSignInRecorded: z.boolean(),
  activeSignIn: credentialFingerprintSchema.nullable(),
  preferredSignIn: credentialFingerprintSchema.nullable(),
  primaryManaged: credentialFingerprintSchema.nullable(),
  legacyManaged: credentialFingerprintSchema.nullable(),
});

function fingerprintGoogleCredentials(
  credentials: { clientId: string; clientSecret: string } | null,
) {
  if (!credentials) return null;
  return {
    clientId: credentials.clientId,
    secretSha256: createHash("sha256")
      .update(credentials.clientSecret)
      .digest("hex"),
    secretLast4:
      credentials.clientSecret.length > 8
        ? credentials.clientSecret.slice(-4)
        : null,
  };
}

export default defineAction({
  description:
    "Read the workspace's environment for Settings › Infrastructure: the database (provider, host, and the variable it comes from; never the URL), where the apps are hosted and each app's address, which deploy variables are set (DATABASE_URL, A2A_SECRET, BETTER_AUTH_SECRET, APP_URL, SECRETS_ENCRYPTION_KEY; values are never returned), and which services the app profile marks required or recommended. Owners and admins only. These are set on the host, not in Settings: to change one, set it in the host's environment and redeploy. For storage use get-file-storage, for services manage-service-providers, and for AI providers list-model-providers. Set includeGoogleCredentialFingerprints only to compare Google OAuth credentials during an authorized incident review.",
  schema: z.object({
    includeGoogleCredentialFingerprints: z
      .union([
        z.boolean(),
        z.literal("true").transform(() => true),
        z.literal("false").transform(() => false),
      ])
      .optional()
      .describe(
        "Include admin-only SHA-256 fingerprints and final four characters for the active and preferred Google sign-in credentials and primary and legacy managed credentials; defaults to false.",
      ),
  }),
  outputSchema: infrastructureStatusOutputSchema.extend({
    googleCredentialFingerprints: googleCredentialFingerprintsSchema.optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  // The database host and deploy layout are not for sandboxed extensions.
  toolCallable: false,
  run: async (
    args,
    ctx,
  ): Promise<
    ReturnType<typeof getInfrastructureStatus> & {
      googleCredentialFingerprints?: z.infer<
        typeof googleCredentialFingerprintsSchema
      >;
    }
  > => {
    const email = ctx?.userEmail?.trim().toLowerCase();
    if (!email) {
      fail("Sign in to view infrastructure.", { statusCode: 401 });
    }
    const orgId = ctx?.orgId?.trim();
    // The status is deployment-wide, not per user, so a caller with no
    // organization reads it only where the deployment has a single tenant. On
    // a shared hosted deployment anyone who signs up starts with no org.
    if (!orgId) {
      if (
        !isTrustedSelfHostedRuntime() ||
        args.includeGoogleCredentialFingerprints
      ) {
        fail("Only organization owners and admins can view infrastructure.", {
          statusCode: 403,
          errorCode: INFRASTRUCTURE_ADMIN_REQUIRED_ERROR_CODE,
        });
      }
    } else {
      const role = await readOrgMemberRole(orgId, email);
      if (!role) {
        fail("You aren't a member of this organization.", {
          statusCode: 403,
        });
      }
      if (!canManageOrg(role)) {
        fail("Only organization owners and admins can view infrastructure.", {
          statusCode: 403,
          errorCode: INFRASTRUCTURE_ADMIN_REQUIRED_ERROR_CODE,
        });
      }
    }
    const status = getInfrastructureStatus(
      ctx?.appId ? { appId: ctx.appId } : {},
    );
    if (!args.includeGoogleCredentialFingerprints) return status;

    const activeSignIn = getActiveGoogleSignInCredentials();
    return {
      ...status,
      googleCredentialFingerprints: {
        activeSignInRecorded: activeSignIn.recorded,
        activeSignIn: activeSignIn.recorded
          ? fingerprintGoogleCredentials(activeSignIn.credentials)
          : null,
        preferredSignIn: fingerprintGoogleCredentials(
          resolveGoogleSignInCredentials(),
        ),
        primaryManaged: fingerprintGoogleCredentials(
          resolveGoogleProviderCredentials(),
        ),
        legacyManaged: fingerprintGoogleCredentials(
          resolveGoogleLegacyProviderCredentials(),
        ),
      },
    };
  },
});
