import { createHash } from "node:crypto";

import { fail, isActionContractError } from "@agent-native/core/action";
import { resolveCredentialDetailed } from "@agent-native/core/credentials";
import {
  getRequestContext,
  runWithRequestContext,
} from "@agent-native/core/server";

import type { OrganizationBigQueryCredentialReadiness } from "../../shared/bigquery-source-contract.js";

function isExactOrgCredential(
  credential: Awaited<ReturnType<typeof resolveCredentialDetailed>>,
  orgId: string,
): boolean {
  return Boolean(
    credential?.scope === "org" &&
    credential.scopeId === orgId &&
    typeof credential.value === "string" &&
    credential.value.trim(),
  );
}

function requireCurrentOrganizationContext({
  orgId,
  userEmail,
}: {
  orgId: string;
  userEmail: string;
}) {
  const requestContext = getRequestContext();
  if (
    !requestContext ||
    typeof requestContext.orgId !== "string" ||
    !requestContext.orgId ||
    typeof requestContext.userEmail !== "string" ||
    !requestContext.userEmail.trim()
  ) {
    fail("An authenticated workspace member is required.", {
      errorCode: "workspace_required",
      statusCode: 403,
    });
  }

  const activeUserEmail = requestContext.userEmail.trim().toLowerCase();
  if (
    requestContext.orgId !== orgId ||
    activeUserEmail !== userEmail.trim().toLowerCase()
  ) {
    fail(
      "Organization BigQuery access must use the active workspace context.",
      {
        errorCode: "bigquery_org_context_mismatch",
        statusCode: 403,
      },
    );
  }

  return {
    requestContext,
    orgId: requestContext.orgId,
    userEmail: activeUserEmail,
  };
}

export async function getOrganizationBigQueryCredentialReadiness({
  orgId,
  userEmail,
}: {
  orgId: string;
  userEmail: string;
}): Promise<Exclude<OrganizationBigQueryCredentialReadiness, "unavailable">> {
  const activeContext = requireCurrentOrganizationContext({ orgId, userEmail });
  const context = {
    userEmail: activeContext.userEmail,
    orgId: activeContext.orgId,
    credentialScope: "org" as const,
  };
  const [project, serviceAccount] = await Promise.all([
    resolveCredentialDetailed("BIGQUERY_PROJECT_ID", context),
    resolveCredentialDetailed("GOOGLE_APPLICATION_CREDENTIALS_JSON", context),
  ]).catch((error: unknown) => {
    if (isActionContractError(error)) throw error;
    fail(
      "Organization BigQuery credentials could not be checked. Retry shortly.",
      { errorCode: "bigquery_credentials_unavailable", statusCode: 503 },
    );
  });
  const hasProject = isExactOrgCredential(project, orgId);
  const hasServiceAccount = isExactOrgCredential(serviceAccount, orgId);
  if (hasProject && hasServiceAccount) return "configured";
  return hasProject || hasServiceAccount ? "partial" : "missing";
}

export async function requireOrganizationBigQueryCredentials({
  orgId,
  userEmail,
}: {
  orgId: string;
  userEmail: string;
}): Promise<void> {
  const activeContext = requireCurrentOrganizationContext({ orgId, userEmail });
  const readiness =
    await getOrganizationBigQueryCredentialReadiness(activeContext);
  if (readiness === "configured") return;
  if (readiness === "missing") {
    fail("Organization BigQuery credentials are not configured.", {
      errorCode: "bigquery_org_credentials_missing",
      statusCode: 409,
    });
  }
  fail("Organization BigQuery credentials are incomplete.", {
    errorCode: "bigquery_org_credentials_incomplete",
    statusCode: 409,
  });
}

export async function requireOrganizationBigQueryProjectId({
  orgId,
  userEmail,
}: {
  orgId: string;
  userEmail: string;
}): Promise<string> {
  await requireOrganizationBigQueryCredentials({ orgId, userEmail });
  const activeContext = requireCurrentOrganizationContext({ orgId, userEmail });
  let project: Awaited<ReturnType<typeof resolveCredentialDetailed>> | null;
  try {
    project = await resolveCredentialDetailed("BIGQUERY_PROJECT_ID", {
      userEmail: activeContext.userEmail,
      orgId: activeContext.orgId,
      credentialScope: "org",
    });
  } catch {
    fail(
      "Organization BigQuery settings could not be checked. Retry shortly.",
      {
        errorCode: "bigquery_credentials_unavailable",
        statusCode: 503,
      },
    );
  }
  if (!project || !isExactOrgCredential(project, orgId)) {
    fail("The active organization has no valid BigQuery project setting.", {
      errorCode: "bigquery_project_id_invalid",
      statusCode: 409,
    });
  }
  const projectId = project.value.trim();
  if (!/^[A-Za-z0-9-]{1,128}$/.test(projectId)) {
    fail("The active organization has no valid BigQuery project setting.", {
      errorCode: "bigquery_project_id_invalid",
      statusCode: 409,
    });
  }
  return projectId;
}

export async function requireOrganizationBigQueryAuthority(scope: {
  orgId: string;
  userEmail: string;
}) {
  const projectId = await requireOrganizationBigQueryProjectId(scope);
  const { orgId, userEmail } = requireCurrentOrganizationContext(scope);
  const credential = await resolveCredentialDetailed(
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    {
      orgId,
      userEmail,
      credentialScope: "org",
    },
  );
  if (!credential || !isExactOrgCredential(credential, orgId))
    fail("Organization BigQuery credentials are incomplete.", {
      errorCode: "bigquery_org_credentials_incomplete",
      statusCode: 409,
    });
  return {
    projectId,
    revision: createHash("sha256").update(credential.value).digest("hex"),
  };
}

export async function withOrganizationBigQueryRequestContext<T>(
  { orgId, userEmail }: { orgId: string; userEmail: string },
  run: () => T | Promise<T>,
): Promise<T> {
  const activeContext = requireCurrentOrganizationContext({ orgId, userEmail });
  return await runWithRequestContext(
    {
      ...activeContext.requestContext,
      userEmail: activeContext.userEmail,
      orgId: activeContext.orgId,
      credentialScope: "org",
    },
    run,
  );
}
