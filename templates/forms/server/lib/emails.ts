/**
 * Catalog entries for the transactional emails Forms sends.
 *
 * Registered from `server/plugins/transactional-emails.ts` so Dispatch can list
 * and preview them without the app having sent anything yet.
 */

import { defineTransactionalEmail } from "@agent-native/core/email-catalog";

import { renderNewResponseEmail } from "./response-email.js";

export const FORMS_NEW_RESPONSE_EMAIL_ID = "forms.new-response";

let registered = false;

export function registerFormsEmails(): void {
  if (registered) return;
  registered = true;

  defineTransactionalEmail({
    id: FORMS_NEW_RESPONSE_EMAIL_ID,
    name: "New form response",
    trigger:
      "A response is submitted and persisted for a form whose settings have `emailOnNewResponses` enabled. Delivery is best-effort: a send failure never rejects the submission.",
    recipient:
      "The form's `ownerEmail`, and only that address — the respondent is never emailed. Skipped when the form has no owner address.",
    sender:
      "The configured default sender. This call site sets no `from`, `fromName`, `replyTo`, or `appSender`, so a reply goes to the sending mailbox rather than to the respondent.",
    preview: () =>
      renderNewResponseEmail({
        formTitle: "Beta feedback",
        fields: [
          { id: "name", type: "text", label: "Name", required: true },
          { id: "email", type: "email", label: "Email", required: true },
          {
            id: "notes",
            type: "textarea",
            label: "What should we fix first?",
            required: false,
          },
        ],
        data: {
          name: "Sam Rivera",
          email: "sam.rivera@example.com",
          notes: "The export button is hard to find on mobile.",
        },
        submittedAt: "2025-03-04T17:20:00.000Z",
      }),
  });
}
