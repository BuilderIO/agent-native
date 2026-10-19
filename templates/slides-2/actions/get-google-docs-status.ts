import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { resolveManagedGoogleDriveAccount } from "../server/lib/google-docs-access.js";
import { formatGoogleOAuthError } from "../server/lib/google-docs-error.js";
import {
  getGooglePickerConfig,
  getGoogleOAuthClientId,
  hasGoogleDriveExportScope,
  hasGoogleDriveUploadScope,
  isGoogleDocsOAuthConfigured,
  listGoogleDocsAccounts,
} from "../server/lib/google-docs-oauth.js";
import {
  resolveGoogleSlidesExportAvailability,
  type GoogleSlidesExportAvailability,
} from "../server/lib/google-slides-export-availability.js";

const appOriginSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).origin === value)
  .describe("Current Slides app origin for checking Google OAuth setup");

export default defineAction({
  title: "Get Google Docs connection status",
  description:
    "Read the signed-in user's Google Docs connection and Picker setup status for Slides.",
  schema: z.object({
    origin: appOriginSchema,
  }),
  http: { method: "GET" },
  readOnly: true,
  retrySafe: true,
  requiresAuth: true,
  uiOnly: true,
  agentTool: false,
  run: async ({ origin }) => {
    const owner = getRequestUserEmail();
    if (!owner) {
      fail("not_authenticated", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });
    }

    try {
      const accounts = await listGoogleDocsAccounts(owner);
      let googleSlidesUrlImportError: string | undefined;
      if (
        !accounts.some((account) => hasGoogleDriveExportScope(account.scope))
      ) {
        try {
          const managed = await resolveManagedGoogleDriveAccount();
          if (managed) {
            accounts.push({
              email: managed.email,
              scope: managed.scope,
              shared: true,
            });
          }
        } catch (error) {
          googleSlidesUrlImportError = formatGoogleOAuthError(error);
        }
      }
      const picker = await getGooglePickerConfig(owner);
      const configured = await isGoogleDocsOAuthConfigured(owner);
      let googleSlidesExport: GoogleSlidesExportAvailability | undefined;
      try {
        googleSlidesExport = await resolveGoogleSlidesExportAvailability({
          configured,
          clientId: configured ? await getGoogleOAuthClientId(owner) : null,
          origin,
          hasUploadCapableAccount: accounts.some((account) =>
            hasGoogleDriveUploadScope(account.scope),
          ),
        });
      } catch (error) {
        console.warn(
          "[slides] could not determine Google Slides export availability:",
          formatGoogleOAuthError(error),
        );
      }

      return {
        configured,
        ...(googleSlidesExport ? { googleSlidesExport } : {}),
        connected: accounts.length > 0,
        googleSlidesUrlImportReady: accounts.some((account) =>
          hasGoogleDriveExportScope(account.scope),
        ),
        googleSlidesUrlImportError,
        accounts,
        pickerConfigured: !!(picker.apiKey && picker.appId),
        pickerApiKey: picker.apiKey,
        pickerAppId: picker.appId,
      };
    } catch (error) {
      fail(formatGoogleOAuthError(error), {
        errorCode: "google_docs_status_failed",
        statusCode: 500,
      });
    }
  },
});
