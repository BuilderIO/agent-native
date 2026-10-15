import { fail } from "@agent-native/core/action";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import {
  getRequestOrgId,
  getRequestUserEmail,
  buildDeepLink,
} from "@agent-native/core/server";

import { SIGMA_DASHBOARD_MIGRATION } from "../../../shared/feature-flags.js";
import { hasCredential } from "../credentials.js";
import { resolveBigQueryOAuthCredential } from "../provider-credentials.js";

export interface SigmaMigrationContext {
  email: string;
  userEmail: string;
  orgId: string;
}

export async function requireSigmaMigrationContext(): Promise<SigmaMigrationContext> {
  const email = getRequestUserEmail()?.trim();
  if (!email) {
    fail("Sign in to use Sigma dashboard migration.", {
      errorCode: "authentication_required",
      statusCode: 401,
    });
  }
  const orgId = getRequestOrgId()?.trim();
  if (!orgId) {
    fail("Select an active organization to use Sigma dashboard migration.", {
      errorCode: "organization_required",
      statusCode: 403,
    });
  }
  const userEmail = email.toLowerCase();
  if (
    !(await isFeatureFlagEnabled(SIGMA_DASHBOARD_MIGRATION, {
      userEmail,
      orgId,
    }))
  ) {
    fail("Sigma dashboard migration is not enabled for this workspace.", {
      errorCode: "feature_disabled",
      statusCode: 404,
    });
  }
  return { email, userEmail, orgId };
}

export async function hasAnalyticsBigQuerySource(
  context: SigmaMigrationContext,
): Promise<boolean> {
  const credentialContext = {
    userEmail: context.userEmail,
    orgId: context.orgId,
  };
  const [projectConfigured, serviceAccountConfigured, oauthCredential] =
    await Promise.all([
      hasCredential("BIGQUERY_PROJECT_ID", credentialContext),
      hasCredential("GOOGLE_APPLICATION_CREDENTIALS_JSON", credentialContext),
      resolveBigQueryOAuthCredential(credentialContext),
    ]);
  return projectConfigured && (serviceAccountConfigured || !!oauthCredential);
}

export function sigmaMigrationSetupLink(source: "sigma" | "bigquery"): string {
  if (source === "sigma") {
    return buildDeepLink({ app: "dispatch", view: "overview" });
  }
  return buildDeepLink({
    app: "analytics",
    view: "data-sources",
    to: "/data-sources?source=bigquery&returnTo=ask",
  });
}
