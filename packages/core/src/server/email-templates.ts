import { isFirstPartyApp } from "../app-config/app-identity.js";
import { getAppConfig, type AppConfig } from "../app-config/index.js";
import { renderEmail, emailStrong } from "./email-template.js";

export const AGENT_NATIVE_REPLY_TO = "agent-native@builder.io";

export interface RenderedEmailMessage {
  subject: string;
  html: string;
  text: string;
  appSender?: { name: string; slug: string; replyTo?: string };
}

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

export interface RenderInviteEmailArgs {
  invitee: string;
  orgName: string;
  acceptUrl: string;
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

export interface RenderVerifySignupEmailArgs {
  email: string;
  verifyUrl: string;
}

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

export interface RenderChangeEmailConfirmationArgs {
  email: string;
  newEmail: string;
  confirmationUrl: string;
}

export function renderChangeEmailConfirmationEmail(
  args: RenderChangeEmailConfirmationArgs,
): RenderedEmailMessage {
  const email = stripCrlf(args.email);
  const newEmail = stripCrlf(args.newEmail);
  const brand = resolveBrand();
  const { html, text } = renderEmail({
    brandName: brand.name,
    brandLogoUrl: brand.logoUrl,
    preheader: `Confirm the email change for ${brand.name}.`,
    heading: `Confirm your email change`,
    paragraphs: [
      `A request was made to change your ${emailStrong(brand.name)} account from ${emailStrong(email)} to ${emailStrong(newEmail)}. Confirm this request to verify the new address.`,
      `If you didn't request this change, you can safely ignore this email.`,
    ],
    cta: { label: "Confirm email change", url: args.confirmationUrl },
  });
  return {
    subject: `Confirm your email change for ${brand.name}`,
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

export interface RenderChangeEmailVerificationArgs {
  email: string;
  verifyUrl: string;
}

export function renderChangeEmailVerificationEmail(
  args: RenderChangeEmailVerificationArgs,
): RenderedEmailMessage {
  const email = stripCrlf(args.email);
  const brand = resolveBrand();
  const { html, text } = renderEmail({
    brandName: brand.name,
    brandLogoUrl: brand.logoUrl,
    preheader: `Verify ${email} for your ${brand.name} account.`,
    heading: "Verify your new email",
    paragraphs: [
      `Confirm that ${emailStrong(email)} is your email address for ${emailStrong(brand.name)}.`,
      `This link expires in 1 hour. If you didn't request this change, you can safely ignore this email.`,
    ],
    cta: { label: "Verify new email", url: args.verifyUrl },
  });
  return {
    subject: `Verify your new email for ${brand.name}`,
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

export interface RenderMagicLinkEmailArgs {
  email: string;
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

export interface RenderResetPasswordEmailArgs {
  email: string;
  resetUrl: string;
}

export function renderResetPasswordEmail(
  args: RenderResetPasswordEmailArgs,
): RenderedEmailMessage {
  const email = stripCrlf(args.email);
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
