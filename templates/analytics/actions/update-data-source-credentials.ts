import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  credentialKeys,
  optionalCredentialKeys,
  partitionCredentialUpdate,
} from "../server/lib/credential-keys";
import { deleteCredential, saveCredential } from "../server/lib/credentials";
import { tryRequestCredentialContext } from "../server/lib/credentials-context";
import { loadDashboardSeed } from "../server/lib/dashboard-seeds";
import {
  getScopedSettingRecord,
  putScopedSettingRecord,
  resolveRequestScope,
} from "../server/lib/scoped-settings";

const GA4_CREDENTIAL_KEYS = new Set([
  "GA4_PROPERTY_ID",
  "GOOGLE_APPLICATION_CREDENTIALS_JSON",
]);
const GA_DASHBOARD_ID = "google-analytics";
const SQL_DASHBOARD_KEY = `sql-dashboard-${GA_DASHBOARD_ID}`;
const ALLOWED_KEYS = new Set(credentialKeys.map((k) => k.key));

function validateCredential(key: string, value: string): string | null {
  if (key !== "GOOGLE_APPLICATION_CREDENTIALS_JSON") return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(value);
  } catch {
    return "Service Account JSON is not valid JSON. Upload the file you downloaded from Google Cloud.";
  }

  if ("web" in parsed || "installed" in parsed) {
    return "This looks like an OAuth 2.0 client credential, not a service account key. In Google Cloud Console, go to IAM -> Service Accounts -> (pick an account) -> Keys -> Add Key -> Create new key -> JSON, then upload that file.";
  }

  if (
    parsed.type !== "service_account" ||
    typeof parsed.private_key !== "string" ||
    typeof parsed.client_email !== "string"
  ) {
    return 'Invalid service account JSON: expected fields "type": "service_account", "private_key", and "client_email".';
  }

  return null;
}

export default defineAction({
  description:
    "UI-only: save or clear Analytics data-source credentials. Secret values are encrypted and never returned.",
  schema: z.object({
    vars: z
      .array(
        z.object({
          key: z.string(),
          value: z.string(),
        }),
      )
      .min(1),
  }),
  agentTool: false,
  run: async ({ vars }) => {
    const recognized = vars.filter((v) => ALLOWED_KEYS.has(v.key));
    if (recognized.length === 0) {
      throw new Error("No recognized credential keys in request");
    }

    const { toSave, toDelete, blankRequired } = partitionCredentialUpdate(
      recognized,
      optionalCredentialKeys,
    );
    if (blankRequired.length > 0) {
      throw new Error(
        `Cannot clear required credentials: ${blankRequired.join(", ")}`,
      );
    }
    if (toSave.length === 0 && toDelete.length === 0) {
      throw new Error("No values to save or delete");
    }

    for (const { key, value } of toSave) {
      const validationError = validateCredential(key, value);
      if (validationError) throw new Error(validationError);
    }

    const ctx = tryRequestCredentialContext();
    if (!ctx) throw new Error("Sign in to save credentials");

    for (const { key, value } of toSave) {
      await saveCredential(key, value, ctx);
    }
    for (const key of toDelete) {
      await deleteCredential(key, ctx);
    }

    const savedKeys = new Set(toSave.map((v) => v.key));
    const savedGaCred = [...GA4_CREDENTIAL_KEYS].some((key) =>
      savedKeys.has(key),
    );
    if (savedGaCred) {
      try {
        const scope = resolveRequestScope();
        const existing = await getScopedSettingRecord(scope, SQL_DASHBOARD_KEY);
        if (!existing) {
          const seed = loadDashboardSeed(GA_DASHBOARD_ID);
          if (seed) {
            await putScopedSettingRecord(scope, SQL_DASHBOARD_KEY, seed);
          }
        }
      } catch (err) {
        console.warn(
          "[credentials] failed to seed google-analytics dashboard:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return { saved: toSave.map((v) => v.key), deleted: toDelete };
  },
});
