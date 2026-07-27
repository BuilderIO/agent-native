/**
 * Transactional email renderers for the framework's system emails.
 *
 * Each exported function returns `{ subject, html, text }` so callers can pass
 * the result straight to `sendEmail({ to, ...rendered })`. All three share the
 * same visual identity via the generic `renderEmail` helper in
 * `email-template.ts` — dark card, Inter typography, prominent CTA button.
 *
 * If you need to add another system email (e.g. magic-link, change-email
 * confirmation), add it here rather than inlining `renderEmail` at the call
 * site — keeps the transactional look-and-feel consistent.
 */

import { getAppName, getAppSlug, getAppDescription } from "./app-name.js";
import { renderEmail, emailStrong } from "./email-template.js";

/** Shared reply-to for the framework's transactional emails. */
export const AGENT_NATIVE_REPLY_TO = "hello@agent-native.com";

export interface RenderedEmailMessage {
  subject: string;
  html: string;
  text: string;
  /** Optional sender override ("Name <addr>") for per-app branding. */
  from?: string;
  /** Optional reply-to address. */
  replyTo?: string;
}

/**
 * Strip CRLF from any field that flows into the Subject line — a malicious
 * org name, inviter, or app name could otherwise inject Bcc/Reply-To headers
 * via "Name\r\nBcc: attacker@...".
 */
function stripCrlf(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

function resolveAppName(): string {
  return stripCrlf(getAppName() || "Agent Native");
}

// ---------------------------------------------------------------------------
// Organization invitation
// ---------------------------------------------------------------------------

export interface RenderInviteEmailArgs {
  /** Email address of the person being invited. */
  invitee: string;
  /** Name of the organization they're being invited to. */
  orgName: string;
  /** URL the recipient clicks to accept — usually the app's root URL. */
  acceptUrl: string;
  /** Email (or display name) of the person who sent the invitation. */
  inviter: string;
}

export function renderInviteEmail(
  args: RenderInviteEmailArgs,
): RenderedEmailMessage {
  const invitee = stripCrlf(args.invitee);
  const orgName = stripCrlf(args.orgName || "your team");
  const inviter = stripCrlf(args.inviter);
  const appName = resolveAppName();
  const onApp = appName ? ` on ${appName}` : "";

  const { html, text } = renderEmail({
    brandName: appName,
    preheader: `${inviter} invited you to join ${orgName}${onApp}.`,
    heading: `You're invited to join ${orgName}`,
    paragraphs: [
      `${emailStrong(inviter)} invited you to join ${emailStrong(orgName)}${
        appName ? ` on ${emailStrong(appName)}` : ""
      }.`,
      `Sign in with ${emailStrong(invitee)} to accept the invitation.`,
    ],
    cta: { label: "Accept invitation", url: args.acceptUrl },
    footer: `If you weren't expecting this, you can safely ignore this email.`,
  });

  return {
    subject: `${inviter} invited you to join ${orgName}${onApp}`,
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// Signup email verification
// ---------------------------------------------------------------------------

export interface RenderVerifySignupEmailArgs {
  /** The email address being verified. */
  email: string;
  /** The full verification URL from better-auth. */
  verifyUrl: string;
}

export function renderVerifySignupEmail(
  args: RenderVerifySignupEmailArgs,
): RenderedEmailMessage {
  const email = stripCrlf(args.email);
  const appName = getAppName();
  // Brand each app's verification email as "Agent-Native <App>" so recipients
  // can tell which app they signed up for. Fall back to the generic name when
  // the app can't be resolved (unknown/serverless runtime).
  const brand = appName ? `Agent-Native ${stripCrlf(appName)}` : "Agent Native";
  const description = appName ? getAppDescription() : undefined;
  const slug = appName ? getAppSlug() : undefined;

  const paragraphs = [
    `Thanks for signing up for ${emailStrong(brand)}. To finish creating your account, confirm that ${emailStrong(email)} is your email address.`,
  ];
  if (description) {
    paragraphs.push(`${stripCrlf(description).replace(/\.\s*$/, "")}.`);
  }
  paragraphs.push(`This link expires in 1 hour.`);

  const { html, text } = renderEmail({
    brandName: brand,
    preheader: `Confirm ${email} to finish setting up your ${brand} account.`,
    heading: `Verify your email for ${brand}`,
    paragraphs,
    cta: { label: "Verify email", url: args.verifyUrl },
    footer: `If you didn't sign up, you can safely ignore this email.`,
  });

  return {
    subject: `Verify your email for ${brand}`,
    html,
    text,
    from: slug ? `${brand} <${slug}@agent-native.com>` : undefined,
    replyTo: AGENT_NATIVE_REPLY_TO,
  };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export interface RenderResetPasswordEmailArgs {
  /** The account email the reset is for. */
  email: string;
  /** The full reset URL (includes the signed token). */
  resetUrl: string;
}

export function renderResetPasswordEmail(
  args: RenderResetPasswordEmailArgs,
): RenderedEmailMessage {
  const email = stripCrlf(args.email);
  const appName = resolveAppName();

  const { html, text } = renderEmail({
    brandName: appName,
    preheader: `Reset the password for ${email}. This link expires in 1 hour.`,
    heading: `Reset your ${appName} password`,
    paragraphs: [
      `Someone requested a password reset for ${emailStrong(email)}. Click the button below to choose a new password.`,
      `This link expires in 1 hour.`,
    ],
    cta: { label: "Reset password", url: args.resetUrl },
    footer: `If you didn't request this, you can safely ignore this email — your password won't change.`,
  });

  return {
    subject: `Reset your ${appName} password`,
    html,
    text,
  };
}
