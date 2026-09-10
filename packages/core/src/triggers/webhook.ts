import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const AUTOMATION_WEBHOOK_PLATFORM = "automation-webhook";
export const AUTOMATION_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

const WEBHOOK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface AutomationWebhookTaskPayload {
  kind: "automation-webhook";
  automationId: string;
  owner: string;
  path: string;
  eventId: string;
  payload: unknown;
}

export function createAutomationWebhookToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isAutomationWebhookToken(value: string): boolean {
  return WEBHOOK_TOKEN_RE.test(value);
}

export function automationWebhookPath(token: string): string {
  return `/_agent-native/automations/webhook/${token}`;
}

export function automationWebhookTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function webhookTokensMatch(
  expected: string | undefined,
  received: string,
): boolean {
  if (!expected || !isAutomationWebhookToken(received)) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}
