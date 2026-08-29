import { randomUUID } from "node:crypto";

const MAILOSAUR_API = "https://mailosaur.com/api";
const MAILOSAUR_DOMAIN_SUFFIX = ".mailosaur.net";
const EMAIL_WAIT_TIMEOUT_MS = 180_000;
const EMAIL_POLL_INTERVAL_MS = 2_000;

interface MailosaurRecipient {
  email?: string;
}

interface MailosaurLink {
  href?: string;
  text?: string;
}

interface MailosaurMessageSummary {
  id: string;
  subject?: string;
  to?: MailosaurRecipient[];
  received?: string;
}

interface MailosaurMessageList {
  items?: MailosaurMessageSummary[];
}

export interface MailosaurMessage extends MailosaurMessageSummary {
  html?: { body?: string; links?: MailosaurLink[] };
  text?: { body?: string; links?: MailosaurLink[] };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for signup E2E.`);
  return value;
}

function serverId(): string {
  const value = requiredEnv("MAILOSAUR_SERVER_ID");
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/i.test(value)) {
    throw new Error("MAILOSAUR_SERVER_ID has an invalid format.");
  }
  return value;
}

function authorizationHeader(): string {
  const apiKey = requiredEnv("MAILOSAUR_API_KEY");
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: authorizationHeader(),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Mailosaur API returned HTTP ${response.status}.`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("Mailosaur API returned invalid JSON.");
  }
}

function normalizeEmail(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function messageIsForEmail(
  message: MailosaurMessageSummary,
  email: string,
): boolean {
  return (message.to ?? []).some(
    (recipient) => normalizeEmail(recipient.email) === normalizeEmail(email),
  );
}

function isAuthMessage(message: MailosaurMessageSummary): boolean {
  return /sign[\s-]?in|verif/i.test(message.subject ?? "");
}

async function listMessages(receivedAfter: number) {
  const params = new URLSearchParams({
    server: serverId(),
    receivedAfter: new Date(receivedAfter).toISOString(),
    itemsPerPage: "100",
    dir: "Received",
  });
  const result = await getJson<
    MailosaurMessageList | MailosaurMessageSummary[]
  >(`${MAILOSAUR_API}/messages?${params.toString()}`);
  return Array.isArray(result) ? result : (result.items ?? []);
}

export function createQaEmail(app: string, environment: string): string {
  const run = (process.env.GITHUB_RUN_ID ?? Date.now().toString(36))
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  const attempt = (process.env.GITHUB_RUN_ATTEMPT ?? "1").replace(
    /[^a-z0-9]/gi,
    "",
  );
  const nonce = randomUUID().replace(/-/g, "").slice(0, 10);
  return `signup+qa-test-bot-${run || "local"}-${attempt || "1"}-${environment}-${app}-${nonce}@${serverId()}${MAILOSAUR_DOMAIN_SUFFIX}`;
}

export async function waitForVerificationEmail(
  email: string,
  receivedAfter: number,
): Promise<MailosaurMessage> {
  const deadline = Date.now() + EMAIL_WAIT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const summaries = await listMessages(receivedAfter);
    const summary = summaries.find(
      (message) => messageIsForEmail(message, email) && isAuthMessage(message),
    );
    if (summary) {
      return getJson<MailosaurMessage>(
        `${MAILOSAUR_API}/messages/${encodeURIComponent(summary.id)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, EMAIL_POLL_INTERVAL_MS));
  }
  throw new Error(
    `No verification email for ${email} arrived within ${EMAIL_WAIT_TIMEOUT_MS / 1000}s.`,
  );
}

function linksFromMessage(message: MailosaurMessage): string[] {
  const structured = [
    ...(message.html?.links ?? []),
    ...(message.text?.links ?? []),
  ]
    .map((link) => link.href?.trim())
    .filter((href): href is string => Boolean(href));
  const bodies = [message.html?.body, message.text?.body].filter(
    (body): body is string => Boolean(body),
  );
  const plainText = bodies.flatMap(
    (body) =>
      body.replace(/&amp;/g, "&").match(/https?:\/\/[^\s"'<>]+/gi) ?? [],
  );
  return [...new Set([...structured, ...plainText])];
}

function linkOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "invalid-url";
  }
}

export function verificationLinkFor(
  message: MailosaurMessage,
  expectedOrigin: string,
): string {
  const links = linksFromMessage(message);
  const expected = new URL(expectedOrigin);
  const secureSameOrigin = links.find((href) => {
    try {
      const url = new URL(href, expectedOrigin);
      return url.protocol === "https:" && url.origin === expected.origin;
    } catch {
      return false;
    }
  });
  if (!secureSameOrigin) {
    const observed = links.map(linkOrigin).join(", ") || "none";
    throw new Error(
      `Verification email contained no HTTPS link back to ${expected.origin}; observed origins: ${observed}.`,
    );
  }
  return secureSameOrigin;
}
