import { defineAction, fail } from "@agent-native/core/action";
import {
  deleteCredential,
  saveCredential,
} from "@agent-native/core/credentials";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  deleteOrganizationBigQueryDetails,
  saveOrganizationBigQueryDetails,
} from "../server/lib/org-bigquery-connection-details.js";
import { getOrganizationBigQueryCredentialReadiness } from "../server/lib/org-bigquery-credentials.js";
import {
  requireBigQueryModelCurator,
  requireSemanticOrg,
} from "./_semantic-helpers.js";

const MAX_SERVICE_ACCOUNT_BYTES = 65_536;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/**
 * Reads the service account file a person pasted or uploaded and keeps only
 * what a BigQuery connection needs. The credential value is never returned,
 * logged or echoed: it goes straight to the encrypted credential store.
 */
function parseServiceAccount(raw: string): string {
  if (Buffer.byteLength(raw, "utf8") > MAX_SERVICE_ACCOUNT_BYTES) {
    fail(
      `That service account file is larger than ${MAX_SERVICE_ACCOUNT_BYTES / 1024} KiB, which is larger than a Google service account key. Upload the JSON key file itself.`,
      { errorCode: "bigquery_service_account_too_large", statusCode: 413 },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(
      "That is not valid JSON. Paste the whole service account key file, starting with a brace.",
      { errorCode: "bigquery_service_account_invalid_json", statusCode: 422 },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(
      "That JSON is not a service account key. A key file is an object with client_email, private_key and project_id.",
      { errorCode: "bigquery_service_account_invalid_shape", statusCode: 422 },
    );
  }
  const key = parsed as Record<string, unknown>;
  const clientEmail = key.client_email;
  const privateKey = key.private_key;
  if (typeof clientEmail !== "string" || !clientEmail.includes("@")) {
    fail(
      "The service account key has no usable client_email. Download the key again from the service account's Keys page.",
      { errorCode: "bigquery_service_account_missing_email", statusCode: 422 },
    );
  }
  if (typeof privateKey !== "string" || !privateKey.includes("PRIVATE KEY")) {
    fail(
      "The service account key has no usable private_key. Download the JSON key again from the service account's Keys page.",
      { errorCode: "bigquery_service_account_missing_key", statusCode: 422 },
    );
  }
  return JSON.stringify(key);
}

/**
 * The dbt save action runs the same warehouse validation before it touches the
 * dbt vault, so the two paths refuse the same project IDs and key files. The
 * connection payload has already been parsed by its schema at this point; this
 * re-checks the parts the write depends on and returns the payload unchanged.
 */
export function validateOrganizationBigQuerySaveInput<
  T extends {
    projectId: string;
    serviceAccountJson?: string | undefined;
  },
>(connection: T): T {
  if (!PROJECT_ID.test(connection.projectId)) {
    fail(
      "That is not a Google Cloud project ID. A project ID is 6 to 30 characters: lowercase letters, digits and hyphens, starting with a letter.",
      { errorCode: "bigquery_project_id_invalid", statusCode: 422 },
    );
  }
  if (connection.serviceAccountJson !== undefined) {
    parseServiceAccount(connection.serviceAccountJson);
  }
  return connection;
}

export default defineAction({
  description:
    "Save or remove the workspace's organization BigQuery connection: the project ID and service account key an admin registers so every member can query through it. Returns the resulting credential readiness and never returns the credential itself.",
  schema: z.object({
    action: z
      .enum(["save", "remove"])
      .describe(
        "save stores the project ID and service account key; remove deletes the workspace's stored pair.",
      ),
    projectId: z
      .string()
      .trim()
      .max(63)
      .optional()
      .describe("Google Cloud project ID that holds the datasets to query."),
    serviceAccountJson: z
      .string()
      .max(MAX_SERVICE_ACCOUNT_BYTES * 2)
      .optional()
      .describe(
        "The exact contents of the service account JSON key file. Never echoed back.",
      ),
    connectionName: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe(
        "The name a person gave the connection, shown wherever the workspace lists it.",
      ),
    connectionDescription: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .describe("What the connection is for, in the person's own words."),
  }),
  http: { method: "POST" },
  readOnly: false,
  audit: {
    // The service account key is a credential: it is neither logged nor kept
    // in the action record.
    recordInputs: false,
  },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({
    action,
    connectionDescription,
    connectionName,
    projectId,
    serviceAccountJson,
  }) => {
    const orgId = await requireSemanticOrg();
    const userEmail = getRequestUserEmail()?.trim().toLowerCase();
    if (!userEmail) {
      fail("An authenticated workspace member is required.", {
        errorCode: "bigquery_connection_workspace_required",
        statusCode: 403,
      });
    }
    await requireBigQueryModelCurator({ orgId, userEmail });
    const context = { userEmail, orgId, scope: "org" as const };

    if (action === "remove") {
      await deleteCredential("BIGQUERY_PROJECT_ID", context);
      await deleteCredential("GOOGLE_APPLICATION_CREDENTIALS_JSON", context);
      await deleteOrganizationBigQueryDetails(orgId);
      const readiness = await getOrganizationBigQueryCredentialReadiness({
        orgId,
        userEmail,
      });
      return {
        action,
        credentialReadiness: readiness,
        projectId: null,
        connectionName: null,
        changed: true,
      };
    }

    const trimmedProjectId = projectId?.trim();
    if (!trimmedProjectId) {
      fail(
        "Enter the Google Cloud project ID that holds the datasets to query.",
        { errorCode: "bigquery_project_id_required", statusCode: 422 },
      );
    }
    if (!PROJECT_ID.test(trimmedProjectId)) {
      fail(
        "A Google Cloud project ID is 6 to 30 characters of lowercase letters, digits and hyphens, and starts with a letter. Check the ID in the Google Cloud console's project picker.",
        { errorCode: "bigquery_project_id_invalid", statusCode: 422 },
      );
    }
    const rawKey = serviceAccountJson?.trim();
    if (!rawKey) {
      fail(
        "Paste or upload the service account JSON key file for this project.",
        { errorCode: "bigquery_service_account_required", statusCode: 422 },
      );
    }
    const normalizedKey = parseServiceAccount(rawKey);

    await saveCredential("BIGQUERY_PROJECT_ID", trimmedProjectId, context);
    await saveCredential(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      normalizedKey,
      context,
    );
    // A caller that names only the project still gets a usable name: the
    // project ID the person picked. The form asks for a name of its own.
    const trimmedName = connectionName?.trim() || trimmedProjectId;
    await saveOrganizationBigQueryDetails({
      orgId,
      connectionName: trimmedName,
      connectionDescription: connectionDescription ?? "",
    });

    // A save that did not land would leave the form claiming a connection the
    // workspace does not have.
    const readiness = await getOrganizationBigQueryCredentialReadiness({
      orgId,
      userEmail,
    });
    if (readiness !== "configured") {
      fail(
        "The workspace BigQuery credentials were written but do not read back as configured. Save them again; if this repeats, an administrator should check the workspace settings.",
        { errorCode: "bigquery_credentials_not_persisted", statusCode: 503 },
      );
    }

    return {
      action,
      credentialReadiness: readiness,
      projectId: trimmedProjectId,
      connectionName: trimmedName,
      changed: true,
    };
  },
});
