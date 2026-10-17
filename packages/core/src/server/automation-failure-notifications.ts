import {
  assertBodySize,
  defineEventHandler,
  getHeader,
  getMethod,
  getRequestURL,
  readRawBody,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getAppConfig } from "../app-config/index.js";
import { redactSensitiveEmailBodyContent } from "../email-catalog/redact-body.js";
import { decryptSecretValue, encryptSecretValue } from "../secrets/crypto.js";
import { getUserSetting, putUserSetting } from "../settings/user-settings.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import { getAppProductionUrl } from "./app-url.js";
import { emailStrong, renderEmail } from "./email-template.js";
import { EmailProviderError, getEmailReadiness, sendEmail } from "./email.js";
import { publicFrameworkPath } from "./framework-route-prefix.js";
import { runWithRequestContext } from "./request-context.js";

const UNSUBSCRIBE_PURPOSE = "automation-failure-email";
const UNSUBSCRIBE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const UNSUBSCRIBE_SETTING_PREFIX = "automationFailureEmails:";
const UNSUBSCRIBE_ROUTE = "/automations/email-unsubscribe";

export interface AutomationFailureNotificationInput {
  email: string;
  appId: string | null;
  automation: string;
  path: string;
  orgId: string | null;
  status: "error" | "interrupted";
  error: string | null;
  errorCode: string | null;
  idempotencyKey?: string;
  unsubscribeToken?: string;
}

export type AutomationFailureNotificationResult =
  | { status: "sent"; provider: "resend" | "sendgrid" }
  | { status: "suppressed" | "not-ready" }
  | {
      status: "retry" | "uncertain" | "failed";
      provider: "resend" | "sendgrid";
    };

interface AutomationFailureNotificationOptions {
  onProviderReady?: (
    provider: "resend" | "sendgrid",
  ) => Promise<boolean | void>;
}

interface UnsubscribeClaims {
  purpose: typeof UNSUBSCRIBE_PURPOSE;
  email: string;
  appId: string;
  expiresAt: number;
}

function settingKey(appId: string): string {
  return `${UNSUBSCRIBE_SETTING_PREFIX}${appId}`;
}

function validEmail(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+$/.test(value);
}

function resolvePublicAppUrl(path: string): string {
  const url = new URL(getAppProductionUrl());
  const basePath = getConfiguredAppBasePath();
  let pathname = path;
  if (
    basePath &&
    pathname !== basePath &&
    !pathname.startsWith(`${basePath}/`)
  ) {
    pathname = `${basePath}${pathname}`;
  }
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function createUnsubscribeToken(email: string, appId: string): string {
  return encryptSecretValue(
    JSON.stringify({
      purpose: UNSUBSCRIBE_PURPOSE,
      email,
      appId,
      expiresAt: Date.now() + UNSUBSCRIBE_TTL_MS,
    } satisfies UnsubscribeClaims),
  );
}

export function createAutomationFailureUnsubscribeToken(
  email: string,
  appId: string | null,
): string {
  const appConfig = getAppConfig().app;
  const resolvedAppId =
    appId?.trim() || appConfig.id || appConfig.slug || "unknown";
  return createUnsubscribeToken(email.trim().toLowerCase(), resolvedAppId);
}

function readUnsubscribeClaims(token: string): UnsubscribeClaims | null {
  if (!token || token.length > 4096) return null;
  try {
    const parsed: unknown = JSON.parse(decryptSecretValue(token));
    if (!parsed || typeof parsed !== "object") return null;
    const claims = parsed as Partial<UnsubscribeClaims>;
    if (
      claims.purpose !== UNSUBSCRIBE_PURPOSE ||
      typeof claims.email !== "string" ||
      !validEmail(claims.email) ||
      claims.email !== claims.email.trim().toLowerCase() ||
      typeof claims.appId !== "string" ||
      !claims.appId ||
      typeof claims.expiresAt !== "number" ||
      !Number.isSafeInteger(claims.expiresAt) ||
      claims.expiresAt <= Date.now()
    ) {
      return null;
    }
    return claims as UnsubscribeClaims;
  } catch {
    // coercion-ok: malformed or expired bearer tokens return the same invalid-link result.
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createConfirmationPage(token: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="referrer" content="no-referrer">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Unsubscribe from automation alerts</title>
    <style>
      body { margin: 0; color-scheme: light dark; background: Canvas; color: CanvasText; font: 16px system-ui, sans-serif; }
      main { box-sizing: border-box; max-width: 440px; margin: 12vh auto; padding: 28px; border: 1px solid ButtonBorder; border-radius: 16px; background: Canvas; }
      h1 { margin: 0 0 12px; font-size: 21px; letter-spacing: -0.02em; }
      p { margin: 0 0 24px; color: GrayText; line-height: 1.55; }
      button { border: 1px solid ButtonBorder; border-radius: 9px; padding: 11px 16px; background: ButtonFace; color: ButtonText; font: inherit; font-weight: 600; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>Unsubscribe from automation alerts?</h1>
      <p>Stop email alerts when your automations fail. This does not change the automations themselves.</p>
      <form method="post" action="">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        <input type="hidden" name="List-Unsubscribe" value="One-Click">
        <button type="submit">Unsubscribe</button>
      </form>
    </main>
  </body>
</html>`;
}

function requestToken(event: H3Event, formBody?: URLSearchParams): string {
  const urlToken = getRequestURL(event).searchParams.get("token");
  return urlToken || formBody?.get("token") || "";
}

export function createAutomationFailureUnsubscribeHandler() {
  return defineEventHandler(async (event) => {
    setResponseHeader(event, "Cache-Control", "no-store");
    setResponseHeader(event, "Referrer-Policy", "no-referrer");
    setResponseHeader(
      event,
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );

    const method = getMethod(event);
    let formBody: URLSearchParams | undefined;
    if (method === "POST") {
      if (
        getHeader(event, "content-type")?.split(";", 1)[0]?.trim() !==
        "application/x-www-form-urlencoded"
      ) {
        setResponseStatus(event, 400);
        return "Invalid unsubscribe request.";
      }
      await assertBodySize(event, 1024);
      formBody = new URLSearchParams((await readRawBody(event, "utf8")) ?? "");
    }

    const claims = readUnsubscribeClaims(requestToken(event, formBody));
    if (!claims) {
      setResponseStatus(event, 404);
      return "Unsubscribe link is invalid or expired.";
    }

    if (method === "GET") {
      setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
      return createConfirmationPage(
        getRequestURL(event).searchParams.get("token") ?? "",
      );
    }

    if (method !== "POST") {
      setResponseHeader(event, "Allow", "GET, POST");
      setResponseStatus(event, 405);
      return "Method not allowed.";
    }
    if (formBody?.get("List-Unsubscribe") !== "One-Click") {
      setResponseStatus(event, 400);
      return "Invalid unsubscribe request.";
    }

    await putUserSetting(claims.email, settingKey(claims.appId), {
      enabled: false,
    });
    setResponseStatus(event, 204);
    return null;
  });
}

export async function sendAutomationFailureNotification(
  input: AutomationFailureNotificationInput,
  options?: AutomationFailureNotificationOptions,
): Promise<AutomationFailureNotificationResult> {
  const email = input.email.trim().toLowerCase();
  if (!validEmail(email)) return { status: "suppressed" };

  const appConfig = getAppConfig().app;
  const appId =
    input.appId?.trim() || appConfig.id || appConfig.slug || "unknown";
  const preferences = await getUserSetting(email, settingKey(appId));
  if (preferences?.enabled === false) return { status: "suppressed" };

  const token = input.unsubscribeToken ?? createUnsubscribeToken(email, appId);
  const unsubscribeUrl = new URL(
    resolvePublicAppUrl(publicFrameworkPath(UNSUBSCRIBE_ROUTE)),
  );
  unsubscribeUrl.searchParams.set("token", token);

  const runUrl = resolvePublicAppUrl("/settings/agent/automations");
  const runName = input.automation.replace(/[\r\n]+/g, " ").slice(0, 160);
  const reason = redactSensitiveEmailBodyContent(
    (input.error || input.errorCode || "The run did not finish.")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 400),
  );
  const status = input.status === "interrupted" ? "stopped early" : "failed";
  const rendered = renderEmail({
    preheader: `${runName} ${status}. Open Automations to see why.`,
    heading: "Automation needs attention",
    paragraphs: [
      `${emailStrong(runName)} ${status}.`,
      `Reason: ${emailStrong(reason)}`,
    ],
    cta: { label: "View automation", url: runUrl },
    footer:
      "You can use your email app's unsubscribe control to stop these failure alerts.",
  });

  return runWithRequestContext(
    {
      userEmail: email,
      ...(input.orgId ? { orgId: input.orgId } : {}),
    },
    async () => {
      const currentReadiness = await getEmailReadiness();
      if (currentReadiness.status !== "ready") {
        if (currentReadiness.status !== "not-configured") {
          console.warn(
            `[automations] Failure alert email is ${currentReadiness.status}; skipping delivery.`,
          );
        }
        return { status: "not-ready" };
      }
      const canSend = await options?.onProviderReady?.(
        currentReadiness.provider,
      );
      if (canSend === false) {
        return { status: "uncertain", provider: currentReadiness.provider };
      }
      try {
        await sendEmail({
          to: email,
          subject: `Automation ${status}: ${runName}`,
          html: rendered.html,
          text: rendered.text,
          templateId: "core.automation-failure",
          app: appId,
          orgId: input.orgId ?? undefined,
          disableClickTracking: true,
          timeoutMs: 5_000,
          ...(currentReadiness.provider === "resend" && input.idempotencyKey
            ? { idempotencyKey: input.idempotencyKey }
            : {}),
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl.toString()}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        return { status: "sent", provider: currentReadiness.provider };
      } catch (error) {
        const retryableProviderResponse =
          error instanceof EmailProviderError &&
          (error.responseStatus === 429 ||
            (currentReadiness.provider === "resend" &&
              error.responseStatus === 409));
        if (
          error instanceof EmailProviderError &&
          !retryableProviderResponse &&
          error.responseStatus < 500
        ) {
          return { status: "failed", provider: currentReadiness.provider };
        }
        if (
          currentReadiness.provider === "resend" ||
          retryableProviderResponse
        ) {
          return { status: "retry", provider: currentReadiness.provider };
        }
        return { status: "uncertain", provider: currentReadiness.provider };
      }
    },
  );
}
