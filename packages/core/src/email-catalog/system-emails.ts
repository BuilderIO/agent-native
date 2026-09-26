
import {
  renderChangeEmailConfirmationEmail,
  renderChangeEmailVerificationEmail,
  renderInviteEmail,
  renderMagicLinkEmail,
  renderResetPasswordEmail,
  renderVerifySignupEmail,
} from "../server/email-templates.js";
import { defineTransactionalEmail } from "./registry.js";

const SAMPLE_URL = "https://example.com/accept/sample-token";
const SAMPLE_EMAIL = "sam.rivera@example.com";

export const CORE_INVITE_EMAIL_ID = "core.organization-invite";
export const CORE_VERIFY_SIGNUP_EMAIL_ID = "core.verify-signup";
export const CORE_RESET_PASSWORD_EMAIL_ID = "core.reset-password";
export const CORE_MAGIC_LINK_EMAIL_ID = "core.magic-link";
export const CORE_CHANGE_EMAIL_CONFIRMATION_EMAIL_ID =
  "core.change-email-confirmation";
export const CORE_CHANGE_EMAIL_VERIFICATION_EMAIL_ID =
  "core.change-email-verification";

let registered = false;

export function registerCoreSystemEmails(): void {
  if (registered) return;
  registered = true;

  defineTransactionalEmail({
    id: CORE_CHANGE_EMAIL_CONFIRMATION_EMAIL_ID,
    app: "core",
    name: "Confirm email change",
    trigger: "A signed-in user requests an email-address change.",
    recipientLabel: "Current account address",
    recipient: "The current verified address, before the requested change.",
    senderLabel: "Default, app-branded",
    sender: "The configured EMAIL_FROM, branded with the app name.",
    preview: () =>
      renderChangeEmailConfirmationEmail({
        email: SAMPLE_EMAIL,
        newEmail: "new.address@example.com",
        confirmationUrl: SAMPLE_URL,
      }),
  });

  defineTransactionalEmail({
    id: CORE_CHANGE_EMAIL_VERIFICATION_EMAIL_ID,
    app: "core",
    name: "Verify new email",
    trigger:
      "A user confirms an email-address change at their current address.",
    recipientLabel: "New account address",
    recipient: "The new address supplied in the email-change request.",
    senderLabel: "Default, app-branded",
    sender: "The configured EMAIL_FROM, branded with the app name.",
    preview: () =>
      renderChangeEmailVerificationEmail({
        email: "new.address@example.com",
        verifyUrl: SAMPLE_URL,
      }),
  });

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
    id: CORE_RESET_PASSWORD_EMAIL_ID,
    app: "core",
    name: "Reset password",
    trigger:
      "A user requests a password reset from the sign-in screen. The link expires after one hour.",
    recipientLabel: "Account address",
    recipient:
      "The account address the reset was requested for, never an address supplied in the request body.",
    senderLabel: "Default, app-branded",
    sender:
      "The configured EMAIL_FROM, branded with the app name the reset was requested from.",
    preview: () =>
      renderResetPasswordEmail({
        email: SAMPLE_EMAIL,
        resetUrl: SAMPLE_URL,
      }),
  });

  defineTransactionalEmail({
    id: CORE_MAGIC_LINK_EMAIL_ID,
    app: "core",
    name: "Magic link sign-in",
    trigger:
      "A user submits their email on the sign-in screen while magic-link is the active login mode.",
    recipientLabel: "Sign-in address",
    recipient: "The address typed into the sign-in form.",
    senderLabel: "Default, app-branded",
    sender:
      "The configured EMAIL_FROM, branded with the app name the sign-in happened in.",
    preview: () =>
      renderMagicLinkEmail({
        email: SAMPLE_EMAIL,
        magicLinkUrl: SAMPLE_URL,
      }),
  });
}
