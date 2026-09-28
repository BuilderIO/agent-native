import type { ReactElement } from "react";

import {
  emailHtmlToText,
  type EmailTemplateApp,
} from "../server/email-template.js";
import {
  renderBuilderCreditLimitEmail,
  renderChangeEmailConfirmationEmail,
  renderChangeEmailVerificationEmail,
  renderInviteEmail,
  renderMagicLinkEmail,
  renderResetPasswordEmail,
  renderResourceSharedEmail,
  renderVerifySignupEmail,
  resolveEmailApp,
  resolveEmailBrandApp,
  type RenderBuilderCreditLimitEmailArgs,
  type RenderChangeEmailConfirmationArgs,
  type RenderChangeEmailVerificationArgs,
  type RenderedEmailMessage,
  type RenderInviteEmailArgs,
  type RenderMagicLinkEmailArgs,
  type RenderResetPasswordEmailArgs,
  type RenderResourceSharedEmailArgs,
  type RenderVerifySignupEmailArgs,
} from "../server/email-templates.js";

export const CORE_INVITE_EMAIL_ID = "core.organization-invite";
export const CORE_VERIFY_SIGNUP_EMAIL_ID = "core.verify-signup";
export const CORE_RESET_PASSWORD_EMAIL_ID = "core.reset-password";
export const CORE_MAGIC_LINK_EMAIL_ID = "core.magic-link";
export const CORE_CHANGE_EMAIL_CONFIRMATION_EMAIL_ID =
  "core.change-email-confirmation";
export const CORE_CHANGE_EMAIL_VERIFICATION_EMAIL_ID =
  "core.change-email-verification";
export const CORE_BUILDER_CREDIT_LIMIT_EMAIL_ID = "core.builder-credit-limit";
export const CORE_RESOURCE_SHARED_EMAIL_ID = "core.resource-shared";

/**
 * Data each framework email is rendered from, keyed by catalog id. An
 * override receives these values raw — escape them before interpolating into
 * an HTML string (`escapeEmailHtml`); React escapes them itself.
 */
export interface CoreTransactionalEmailArgs {
  [CORE_VERIFY_SIGNUP_EMAIL_ID]: RenderVerifySignupEmailArgs;
  [CORE_RESET_PASSWORD_EMAIL_ID]: RenderResetPasswordEmailArgs;
  [CORE_MAGIC_LINK_EMAIL_ID]: RenderMagicLinkEmailArgs;
  [CORE_CHANGE_EMAIL_CONFIRMATION_EMAIL_ID]: RenderChangeEmailConfirmationArgs;
  [CORE_CHANGE_EMAIL_VERIFICATION_EMAIL_ID]: RenderChangeEmailVerificationArgs;
  [CORE_INVITE_EMAIL_ID]: RenderInviteEmailArgs;
  [CORE_BUILDER_CREDIT_LIMIT_EMAIL_ID]: RenderBuilderCreditLimitEmailArgs;
  [CORE_RESOURCE_SHARED_EMAIL_ID]: RenderResourceSharedEmailArgs;
}

export type CoreTransactionalEmailId = keyof CoreTransactionalEmailArgs;

export type CoreTransactionalEmailProps<Id extends CoreTransactionalEmailId> =
  CoreTransactionalEmailArgs[Id] & { app: EmailTemplateApp };

export type TransactionalEmailOverrideResult =
  | { subject?: string; html: string; text?: string }
  | { subject?: string; react: ReactElement; text?: string };

export type TransactionalEmailOverride<Id extends CoreTransactionalEmailId> = (
  props: CoreTransactionalEmailProps<Id>,
  defaultEmail: RenderedEmailMessage,
) =>
  | TransactionalEmailOverrideResult
  | Promise<TransactionalEmailOverrideResult>;

interface CoreEmailDefault<Id extends CoreTransactionalEmailId> {
  render: (args: CoreTransactionalEmailArgs[Id]) => RenderedEmailMessage;
  app: (args: CoreTransactionalEmailArgs[Id]) => EmailTemplateApp;
}

const CORE_EMAIL_DEFAULTS: {
  [Id in CoreTransactionalEmailId]: CoreEmailDefault<Id>;
} = {
  [CORE_VERIFY_SIGNUP_EMAIL_ID]: {
    render: (args) => renderVerifySignupEmail(args),
    app: () => resolveEmailBrandApp(),
  },
  [CORE_RESET_PASSWORD_EMAIL_ID]: {
    render: (args) => renderResetPasswordEmail(args),
    app: () => resolveEmailBrandApp(),
  },
  [CORE_MAGIC_LINK_EMAIL_ID]: {
    render: (args) => renderMagicLinkEmail(args),
    app: () => resolveEmailBrandApp(),
  },
  [CORE_CHANGE_EMAIL_CONFIRMATION_EMAIL_ID]: {
    render: (args) => renderChangeEmailConfirmationEmail(args),
    app: () => resolveEmailBrandApp(),
  },
  [CORE_CHANGE_EMAIL_VERIFICATION_EMAIL_ID]: {
    render: (args) => renderChangeEmailVerificationEmail(args),
    app: () => resolveEmailBrandApp(),
  },
  [CORE_INVITE_EMAIL_ID]: {
    render: (args) => renderInviteEmail(args),
    app: () => resolveEmailApp(),
  },
  [CORE_BUILDER_CREDIT_LIMIT_EMAIL_ID]: {
    render: (args) => renderBuilderCreditLimitEmail(args),
    app: () => resolveEmailBrandApp(),
  },
  [CORE_RESOURCE_SHARED_EMAIL_ID]: {
    render: (args) => renderResourceSharedEmail(args),
    app: (args) => args.app,
  },
};

// Overrides are registered through the public `@agent-native/core` entry and
// read through relative imports; a module-local map would split in two when
// dev/SSR loads core twice and silently send the default email.
const OVERRIDES_KEY = "__agentNativeTransactionalEmailOverrides__";
type OverrideStore = Map<
  CoreTransactionalEmailId,
  TransactionalEmailOverride<CoreTransactionalEmailId>
>;
const globalOverrides: { [K in typeof OVERRIDES_KEY]?: OverrideStore } =
  globalThis as any;

function getOverrides(): OverrideStore {
  let store = globalOverrides[OVERRIDES_KEY];
  if (!store) {
    store = new Map();
    globalOverrides[OVERRIDES_KEY] = store;
  }
  return store;
}

function isCoreTransactionalEmailId(
  id: string,
): id is CoreTransactionalEmailId {
  return Object.prototype.hasOwnProperty.call(CORE_EMAIL_DEFAULTS, id);
}

/**
 * Replace the subject, markup, or plain text of a framework-sent email. The
 * framework still owns the recipient, sender identity, and delivery; the
 * override owns what the message says and looks like. A later call for the
 * same id replaces the earlier one.
 */
export function overrideTransactionalEmail<Id extends CoreTransactionalEmailId>(
  id: Id,
  render: TransactionalEmailOverride<Id>,
): void {
  if (!isCoreTransactionalEmailId(id)) {
    throw new Error(
      `Unknown transactional email "${id}". Overridable ids: ${Object.keys(CORE_EMAIL_DEFAULTS).join(", ")}.`,
    );
  }
  if (typeof render !== "function") {
    throw new Error(
      `Transactional email override for "${id}" must be a function.`,
    );
  }
  getOverrides().set(
    id,
    render as TransactionalEmailOverride<CoreTransactionalEmailId>,
  );
}

export function removeTransactionalEmailOverride(
  id: CoreTransactionalEmailId,
): void {
  getOverrides().delete(id);
}

async function renderOverrideHtml(
  id: CoreTransactionalEmailId,
  result: TransactionalEmailOverrideResult,
): Promise<string> {
  if ("react" in result) {
    const { renderToStaticMarkup } = await import("react-dom/server");
    return `<!DOCTYPE html>${renderToStaticMarkup(result.react)}`;
  }
  if (typeof result.html !== "string" || !result.html.trim()) {
    throw new Error(
      `Transactional email override for "${id}" must return non-empty html or a react element.`,
    );
  }
  return result.html;
}

/**
 * Render a framework email: the framework default, or the app's override
 * when one is registered. An override that throws fails the send; it is never
 * swapped for the default, so a broken template surfaces instead of shipping
 * the design the app replaced.
 */
export async function renderTransactionalEmail<
  Id extends CoreTransactionalEmailId,
>(id: Id, args: CoreTransactionalEmailArgs[Id]): Promise<RenderedEmailMessage> {
  const defaults = CORE_EMAIL_DEFAULTS[id] as CoreEmailDefault<Id>;
  const defaultEmail = defaults.render(args);
  const override = getOverrides().get(id) as
    | TransactionalEmailOverride<Id>
    | undefined;
  if (!override) return defaultEmail;

  const props = {
    ...args,
    app: defaults.app(args),
  } as CoreTransactionalEmailProps<Id>;
  const result = await override(props, defaultEmail);
  if (!result || typeof result !== "object") {
    throw new Error(
      `Transactional email override for "${id}" must return { html } or { react }.`,
    );
  }
  const html = await renderOverrideHtml(id, result);
  const subject = (result.subject ?? defaultEmail.subject)
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (!subject) {
    throw new Error(
      `Transactional email override for "${id}" returned an empty subject.`,
    );
  }
  return {
    subject,
    html,
    text: result.text?.trim() || emailHtmlToText(html),
    appSender: defaultEmail.appSender,
  };
}
