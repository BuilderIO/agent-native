/**
 * Catalog entries for the framework's own system emails.
 *
 * These ship with every app rather than belonging to one, so they register
 * under the `core` app instead of the running app's slug. Importing this module
 * performs the registration; `register-system-emails.ts` is the single import
 * site so the emails appear in every app's catalog without each template
 * remembering to opt in.
 */

import {
  renderInviteEmail,
  renderMagicLinkEmail,
  renderResetPasswordEmail,
  renderVerifySignupEmail,
} from "../server/email-templates.js";

import { defineTransactionalEmail } from "./registry.js";

/** Obviously-fake sample data — these render in a preview pane, never send. */
const SAMPLE_URL = "https://example.com/accept/sample-token";
const SAMPLE_EMAIL = "sam.rivera@example.com";

export const CORE_INVITE_EMAIL_ID = "core.organization-invite";
export const CORE_VERIFY_SIGNUP_EMAIL_ID = "core.verify-signup";
export const CORE_MAGIC_LINK_EMAIL_ID = "core.magic-link-sign-in";
export const CORE_RESET_PASSWORD_EMAIL_ID = "core.reset-password";

let registered = false;

export function registerCoreSystemEmails(): void {
  if (registered) return;
  registered = true;

  defineTransactionalEmail({
    id: CORE_INVITE_EMAIL_ID,
    app: "core",
    name: "Organization invitation",
    trigger:
      "A member invites someone to their organization from the team settings page.",
    recipientLabel: "Invited address",
    recipient:
      "The address typed into the invite form. One email per invited address.",
    senderLabel: "Default, app-branded",
    sender:
      "The configured EMAIL_FROM. On first-party agent-native.com deployments the display name becomes the app's own, with reply-to agent-native@builder.io.",
    preview: () =>
      renderInviteEmail({
        invitee: SAMPLE_EMAIL,
        orgName: "Northwind Design",
        acceptUrl: SAMPLE_URL,
        inviter: "alex.chen@example.com",
      }),
  });

  defineTransactionalEmail({
    id: CORE_VERIFY_SIGNUP_EMAIL_ID,
    app: "core",
    name: "Verify signup",
    trigger:
      "A new account is created with email and password, before the account can be used.",
    recipientLabel: "New account address",
    recipient: "The address the account was registered with.",
    senderLabel: "Default, app-branded",
    sender:
      "The configured EMAIL_FROM, branded with the app name the signup happened in.",
    preview: () =>
      renderVerifySignupEmail({
        email: SAMPLE_EMAIL,
        verifyUrl: SAMPLE_URL,
      }),
  });

  defineTransactionalEmail({
    id: CORE_MAGIC_LINK_EMAIL_ID,
    app: "core",
    name: "Magic link sign-in",
    trigger:
      "A user chooses Continue with email on the sign-in screen. The single-use link signs in an existing user or creates a verified account after a new recipient opens it.",
    recipientLabel: "Entered email address",
    recipient:
      "The normalized address entered in the magic-link form. Delivery occurs before the UI reports success.",
    senderLabel: "Configured no-reply",
    sender:
      "The configured EMAIL_FROM with no Reply-To override. First-party deployments use noreply@agent-native.com.",
    preview: () =>
      renderMagicLinkEmail({
        email: SAMPLE_EMAIL,
        magicLinkUrl: SAMPLE_URL,
      }),
  });

  defineTransactionalEmail({
    id: CORE_RESET_PASSWORD_EMAIL_ID,
    app: "core",
    name: "Reset password",
    trigger:
      "A user requests a password reset from the sign-in screen. The link expires after one hour.",
    recipientLabel: "Account address",
    recipient:
      "The account address the reset was requested for, never an address supplied in the request body.",
    senderLabel: "Configured no-reply",
    sender:
      "The configured EMAIL_FROM with no Reply-To override. First-party deployments use noreply@agent-native.com.",
    preview: () =>
      renderResetPasswordEmail({
        email: SAMPLE_EMAIL,
        resetUrl: SAMPLE_URL,
      }),
  });
}
