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

import { isFirstPartyApp } from "../app-config/app-identity.js";
import { getAppConfig, type AppConfig } from "../app-config/index.js";
import { renderEmail, emailStrong } from "./email-template.js";

/** Shared reply-to for the framework's transactional emails. */
export const AGENT_NATIVE_REPLY_TO = "agent-native@builder.io";

export interface RenderedEmailMessage {
  subject: string;
  html: string;
  text: string;
  /**
   * Per-app sender branding, applied by `sendEmail` only on first-party
   * agent-native.com deployments. Self-hosted deployments keep the sender and
   * reply-to they configured via EMAIL_FROM.
   */
  appSender?: { name: string; slug: string; replyTo?: string };
}

/**
 * Strip CRLF from any field that flows into the Subject line — a malicious
 * org name, inviter, or app name could otherwise inject Bcc/Reply-To headers
 * via "Name\r\nBcc: attacker@...".
 */
function stripCrlf(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

function packageDisplayName(
  packageName: string | undefined,
): string | undefined {
  if (!packageName || packageName.startsWith("@agent-native/"))
    return undefined;
  const leaf = packageName.split("/").pop()?.trim();
  if (!leaf) return undefined;
  return leaf
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function resolveBaseAppName(app: AppConfig["app"]): string {
  return stripCrlf(
    app.name || packageDisplayName(app.packageName) || "Agent-Native",
  );
}

function resolveAppName(): string {
  return resolveBaseAppName(getAppConfig().app);
}

interface EmailBrand {
  name: string;
  logoUrl?: string;
  senderSlug?: string;
}

/**
 * Recipient-facing brand for auth emails. Only a recognized first-party
 * template is presented as "Agent-Native <App>"; a custom deployment keeps
 * its own name and logo.
 */
function resolveBrand(): EmailBrand {
  const app = getAppConfig().app;
  const firstParty = isFirstPartyApp(app);
  const baseName = resolveBaseAppName(app);
  return {
    name:
      firstParty && baseName !== "Agent-Native"
        ? `Agent-Native ${baseName}`
        : baseName,
    logoUrl: firstParty ? undefined : app.logoUrl,
    senderSlug: firstParty ? app.slug : undefined,
  };
}

function resolveAppLogoUrl(): string | undefined {
  const app = getAppConfig().app;
  return isFirstPartyApp(app) ? undefined : app.logoUrl;
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
    brandLogoUrl: resolveAppLogoUrl(),
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

/**
 * Customer-facing description overrides for the verification email body. The
 * default descriptions come from the app-picker hints, which name competitors
 * for internal positioning; these rewrites frame them as "replacement" for a
 * customer-facing email without changing the picker copy.
 */
const VERIFY_EMAIL_DESCRIPTIONS: Record<string, string> = {
  calendar:
    "Agent-Native Google Calendar replacement — manage events, sync, and public booking",
  content:
    "Open-source Obsidian/Notion replacement for MDX — edit local docs with agent assistance",
  slides:
    "Agent-Native Google Slides replacement — generate and edit React presentations",
  analytics:
    "Agent-Native Amplitude/Mixpanel replacement — connect data sources, prompt for charts",
  mail: "Agent-Native Superhuman replacement — email client with keyboard shortcuts and AI triage",
};

export function renderVerifySignupEmail(
  args: RenderVerifySignupEmailArgs,
): RenderedEmailMessage {
  const email = stripCrlf(args.email);
  const brand = resolveBrand();
  const description = brand.senderSlug
    ? (VERIFY_EMAIL_DESCRIPTIONS[brand.senderSlug] ??
      getAppConfig().app.description)
    : undefined;

  const paragraphs = [
    `Thanks for signing up for ${emailStrong(brand.name)}. To finish creating your account, confirm that ${emailStrong(email)} is your email address.`,
  ];
  if (description) {
    paragraphs.push(`${stripCrlf(description).replace(/\.\s*$/, "")}.`);
  }
  paragraphs.push(`This link expires in 1 hour.`);

  const { html, text } = renderEmail({
    brandName: brand.name,
    brandLogoUrl: brand.logoUrl,
    preheader: `Confirm ${email} to finish setting up your ${brand.name} account.`,
    heading: `Verify your email for ${brand.name}`,
    paragraphs,
    cta: { label: "Verify email", url: args.verifyUrl },
    footer: `If you didn't sign up, you can safely ignore this email.`,
  });

  return {
    subject: `Verify your email for ${brand.name}`,
    html,
    text,
    appSender: brand.senderSlug
      ? {
          name: brand.name,
          slug: brand.senderSlug,
          replyTo: AGENT_NATIVE_REPLY_TO,
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Magic-link sign-in
// ---------------------------------------------------------------------------

export interface RenderMagicLinkEmailArgs {
  /** The account email receiving the one-time sign-in link. */
  email: string;
  /** The full Better Auth URL containing the one-time token. */
  magicLinkUrl: string;
}

export function renderMagicLinkEmail(
  args: RenderMagicLinkEmailArgs,
): RenderedEmailMessage {
  const email = stripCrlf(args.email);
  const brand = resolveBrand();
  const { html, text } = renderEmail({
    brandName: brand.name,
    brandLogoUrl: brand.logoUrl,
    preheader: `Sign in to ${brand.name} with your secure one-time link.`,
    heading: `Sign in to ${brand.name}`,
    paragraphs: [
      `Use the button below to sign in as ${emailStrong(email)}. This link expires in 5 minutes and can only be used once.`,
      `If you didn't request this email, you can safely ignore it.`,
    ],
    cta: { label: "Sign in securely", url: args.magicLinkUrl },
    footer: `For your security, never forward this email or share the link.`,
  });

  return {
    subject: `Your sign-in link for ${brand.name}`,
    html,
    text,
    appSender: brand.senderSlug
      ? {
          name: brand.name,
          slug: brand.senderSlug,
          replyTo: AGENT_NATIVE_REPLY_TO,
        }
      : undefined,
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
  // Match the verification email branding so password resets are clearly tied
  // to the specific app. No value pitch here — it's a security email.
  const brand = resolveBrand();

  const { html, text } = renderEmail({
    brandName: brand.name,
    brandLogoUrl: brand.logoUrl,
    preheader: `Reset the password for ${email}. This link expires in 1 hour.`,
    heading: `Reset your ${brand.name} password`,
    paragraphs: [
      `Someone requested a password reset for ${emailStrong(email)}. Click the button below to choose a new password.`,
      `This link expires in 1 hour.`,
    ],
    cta: { label: "Reset password", url: args.resetUrl },
    footer: `If you didn't request this, you can safely ignore this email — your password won't change.`,
  });

  return {
    subject: `Reset your ${brand.name} password`,
    html,
    text,
    appSender: brand.senderSlug
      ? {
          name: brand.name,
          slug: brand.senderSlug,
          replyTo: AGENT_NATIVE_REPLY_TO,
        }
      : undefined,
  };
}
