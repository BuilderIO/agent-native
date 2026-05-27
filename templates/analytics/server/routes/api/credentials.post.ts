import { defineEventHandler, setResponseStatus } from "h3";
import {
  saveCredential,
  deleteCredential,
  getCredentialContextFromEvent,
} from "../../lib/credentials";
import {
  credentialKeys,
  optionalCredentialKeys,
  partitionCredentialUpdate,
} from "../../lib/credential-keys";
import { readBody } from "@agent-native/core/server";
import {
  getScopedSettingRecord,
  putScopedSettingRecord,
  resolveSettingsScope,
} from "../../lib/scoped-settings";
import { loadDashboardSeed } from "../../lib/dashboard-seeds";

const GA4_CREDENTIAL_KEYS = new Set([
  "GA4_PROPERTY_ID",
  "GOOGLE_APPLICATION_CREDENTIALS_JSON",
]);
const GA_DASHBOARD_ID = "google-analytics";
const SQL_DASHBOARD_KEY = `sql-dashboard-${GA_DASHBOARD_ID}`;

const ALLOWED_KEYS = new Set(credentialKeys.map((k) => k.key));

/**
 * Validate a credential value before saving. Returns an error message, or null if valid.
 * Catches common mistakes like uploading an OAuth client credential instead of a service account key.
 */
function validateCredential(key: string, value: string): string | null {
  if (key === "GOOGLE_APPLICATION_CREDENTIALS_JSON") {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(value);
    } catch {
      return "Service Account JSON is not valid JSON. Upload the file you downloaded from Google Cloud.";
    }
    if (parsed && typeof parsed === "object") {
      if ("web" in parsed || "installed" in parsed) {
        return "This looks like an OAuth 2.0 client credential, not a service account key. In Google Cloud Console, go to IAM → Service Accounts → (pick an account) → Keys → Add Key → Create new key → JSON, then upload that file.";
      }
      if (
        parsed.type !== "service_account" ||
        typeof parsed.private_key !== "string" ||
        typeof parsed.client_email !== "string"
      ) {
        return 'Invalid service account JSON: expected fields "type": "service_account", "private_key", and "client_email".';
      }
    }
  }
  return null;
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { vars } = body as {
    vars?: Array<{ key: string; value: string }>;
  };

  if (!Array.isArray(vars) || vars.length === 0) {
    setResponseStatus(event, 400);
    return { error: "vars array required" };
  }

  const recognized = vars.filter(
    (v) => typeof v.key === "string" && ALLOWED_KEYS.has(v.key),
  );
  if (recognized.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No recognized credential keys in request" };
  }

  const { toSave, toDelete, blankRequired } = partitionCredentialUpdate(
    recognized,
    optionalCredentialKeys,
  );

  if (blankRequired.length > 0) {
    setResponseStatus(event, 400);
    return {
      error: `Cannot clear required credentials: ${blankRequired.join(", ")}`,
    };
  }

  if (toSave.length === 0 && toDelete.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No values to save or delete" };
  }

  for (const { key, value } of toSave) {
    const validationError = validateCredential(key, value);
    if (validationError) {
      setResponseStatus(event, 400);
      return { error: validationError };
    }
  }

  const ctx = await getCredentialContextFromEvent(event);
  if (!ctx) {
    setResponseStatus(event, 401);
    return { error: "Sign in to save credentials" };
  }
  for (const { key, value } of toSave) {
    await saveCredential(key, value, ctx);
  }
  for (const key of toDelete) {
    await deleteCredential(key, ctx);
  }

  // Auto-seed the Google Analytics SQL dashboard the first time a user
  // wires up either GA4 credential. Idempotent: if the dashboard already
  // exists (even empty) we leave it alone so a user who deleted panels
  // doesn't get them resurrected on the next reconnect.
  const savedKeys = new Set(toSave.map((v) => v.key));
  const savedGaCred = [...GA4_CREDENTIAL_KEYS].some((k) => savedKeys.has(k));
  if (savedGaCred) {
    try {
      const scope = await resolveSettingsScope(event);
      const existing = await getScopedSettingRecord(scope, SQL_DASHBOARD_KEY);
      if (!existing) {
        const seed = loadDashboardSeed(GA_DASHBOARD_ID);
        if (seed) {
          await putScopedSettingRecord(scope, SQL_DASHBOARD_KEY, seed);
        }
      }
    } catch (err: any) {
      // Don't fail the credential save if seeding hiccups — log and move on.
      console.warn(
        "[credentials] failed to seed google-analytics dashboard:",
        err?.message ?? err,
      );
    }
  }

  return { saved: toSave.map((v) => v.key), deleted: toDelete };
});
