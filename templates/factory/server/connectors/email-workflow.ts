import { createHash, randomUUID } from "node:crypto";

import { getEmailReadiness, sendEmail } from "@agent-native/core/server";

import { failWorkflowAction } from "../lib/workflow-action-errors.js";

const EMAIL_RECIPIENTS_MAX = 10;
export const EMAIL_SUBJECT_MAX = 200;
export const EMAIL_BODY_MAX = 20_000;
const EMAIL_SEND_TIMEOUT_MS = 20_000;
const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(markdown: string): string {
  return escapeHtml(markdown)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * A small markdown subset for a notification: paragraphs, bullet lists, bold,
 * code and http(s) links. Everything is escaped first, so the body can carry
 * AI-written text without carrying markup. The plain-text part is the source.
 */
export function renderEmailBody(markdown: string): {
  html: string;
  text: string;
} {
  const blocks = markdown.trim().split(/\n{2,}/);
  const html = blocks
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
        return `<ul>${lines
          .map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`)
          .join("")}</ul>`;
      }
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
  return {
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${html}</div>`,
    text: markdown.trim(),
  };
}

export function parseEmailAddresses(
  value: string | undefined,
  field: string,
): string[] {
  if (value === undefined || !value.trim()) return [];
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const part of value.split(/[,;]/)) {
    const address = part.trim();
    if (!address) continue;
    if (!ADDRESS.test(address)) {
      failWorkflowAction({
        message: `${field} has an entry that is not an email address.`,
        errorCode: "email_recipient_invalid",
        statusCode: 400,
      });
    }
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(address);
  }
  if (addresses.length > EMAIL_RECIPIENTS_MAX) {
    failWorkflowAction({
      message: `${field} lists ${addresses.length} addresses; the most is ${EMAIL_RECIPIENTS_MAX}.`,
      errorCode: "email_recipient_invalid",
      statusCode: 400,
    });
  }
  return addresses;
}

/**
 * Names what is missing instead of letting the framework's development
 * transport log the message and report it sent.
 */
export async function assertEmailReady(): Promise<void> {
  const readiness = await getEmailReadiness();
  if (readiness.status === "ready") return;
  if (readiness.status === "unavailable") {
    failWorkflowAction({
      message:
        "The email credentials could not be read, so it is not known whether a sender is configured.",
      errorCode: "email_credentials_unreadable",
      statusCode: 503,
      retryable: true,
    });
  }
  failWorkflowAction({
    message:
      readiness.status === "misconfigured"
        ? "SendGrid is configured without EMAIL_FROM. Save EMAIL_FROM as a verified sender address."
        : "No email sender is configured. Save RESEND_API_KEY, or SENDGRID_API_KEY with EMAIL_FROM, in the workspace secrets.",
    errorCode: "email_not_configured",
    statusCode: 412,
    details: {
      missing:
        readiness.status === "misconfigured"
          ? ["EMAIL_FROM"]
          : ["RESEND_API_KEY", "SENDGRID_API_KEY"],
    },
  });
}

interface WorkflowEmailInput {
  to: string[];
  cc: string[];
  replyTo?: string;
  subject: string;
  body: string;
  /** Scopes the idempotency key: a retry inside one run must not send twice. */
  identity: {
    orgId: string;
    factoryId: string;
    automationId?: string;
    runId?: string;
    /**
     * Names this one call: the engine's receipt key, which holds the node and
     * item. Two calls in a run with the same text are then two emails, while a
     * retry of one call keeps its key.
     */
    callId?: string;
  };
}

interface WorkflowEmailResult {
  messageRef: string;
  provider: string;
  recipients: string[];
  suppressed: string[];
}

function providerStatus(error: unknown): number | null {
  const candidate = error as {
    name?: unknown;
    responseStatus?: unknown;
  } | null;
  return candidate?.name === "EmailProviderError" &&
    typeof candidate.responseStatus === "number"
    ? candidate.responseStatus
    : null;
}

/**
 * Sends one email per `to` address. The framework transport returns no message
 * id, so `messageRef` is the idempotency key sent to the provider. Without a
 * run id there is no stable key to send, and the reference is a fresh one.
 * Without a call id, identical messages in one run share a key and the
 * provider sends them once.
 */
export async function sendWorkflowEmail(
  input: WorkflowEmailInput,
): Promise<WorkflowEmailResult> {
  const { html, text } = renderEmailBody(input.body);
  const baseKey = input.identity.runId
    ? `factory-email-${createHash("sha256")
        .update(
          JSON.stringify([
            input.identity.orgId,
            input.identity.factoryId,
            input.identity.automationId ?? null,
            input.identity.runId,
            input.identity.callId ?? null,
            input.to,
            input.cc,
            input.replyTo ?? null,
            input.subject,
            input.body,
          ]),
        )
        .digest("hex")
        .slice(0, 40)}`
    : `factory-email-${randomUUID()}`;
  const sent: string[] = [];
  const suppressed: string[] = [];
  let provider = "unknown";
  for (const [index, address] of input.to.entries()) {
    try {
      const result = await sendEmail({
        to: address,
        subject: input.subject,
        html,
        text,
        ...(input.cc.length > 0 ? { cc: input.cc } : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        ...(input.identity.runId
          ? { idempotencyKey: `${baseKey}-${index}` }
          : {}),
        timeoutMs: EMAIL_SEND_TIMEOUT_MS,
      });
      if (result.status === "suppressed") {
        suppressed.push(address);
      } else {
        sent.push(address);
        provider = result.provider;
        suppressed.push(...(result.suppressed ?? []));
      }
    } catch (error) {
      const status = providerStatus(error);
      const rejected = status !== null && status >= 400 && status < 500;
      if (rejected && sent.length === 0) {
        failWorkflowAction({
          message: `The email provider rejected the message (HTTP ${status}); nothing was sent.`,
          errorCode: status === 429 ? "email_rate_limited" : "email_rejected",
          statusCode: status === 429 ? 429 : 424,
          retryable: status === 429,
          details: { status },
        });
      }
      failWorkflowAction({
        message:
          sent.length > 0
            ? `The email provider failed after ${sent.length} of ${input.to.length} messages went out.`
            : "The email provider did not confirm whether the message was sent.",
        errorCode: "email_outcome_unknown",
        statusCode: 424,
        details: { sentTo: sent, ...(status !== null ? { status } : {}) },
      });
    }
  }
  if (sent.length === 0) {
    failWorkflowAction({
      message:
        "Every recipient is a test identity, which never receives non-account email, so nothing was sent.",
      errorCode: "email_recipient_suppressed",
      statusCode: 422,
    });
  }
  return { messageRef: baseKey, provider, recipients: sent, suppressed };
}
