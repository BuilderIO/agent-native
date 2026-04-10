import { defineEventHandler, setResponseStatus } from "h3";
import { saveCredential } from "../../lib/credentials";
import { credentialKeys } from "../../lib/credential-keys";
import { readBody } from "@agent-native/core/server";

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

  const filtered = vars.filter(
    (v) => typeof v.key === "string" && ALLOWED_KEYS.has(v.key) && v.value,
  );
  if (filtered.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No recognized credential keys in request" };
  }

  for (const { key, value } of filtered) {
    const trimmed = value.trim();
    const validationError = validateCredential(key, trimmed);
    if (validationError) {
      setResponseStatus(event, 400);
      return { error: validationError };
    }
  }

  for (const { key, value } of filtered) {
    await saveCredential(key, value.trim());
  }

  return { saved: filtered.map((v) => v.key) };
});
