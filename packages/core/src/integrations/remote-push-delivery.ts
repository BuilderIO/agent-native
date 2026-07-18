import {
  claimNextRemotePushDelivery,
  deactivateRemotePushRegistration,
  failRemotePushDelivery,
  markRemotePushDelivered,
  markRemotePushTicketAccepted,
  retryRemotePushDelivery,
  type ClaimedRemotePushDelivery,
} from "./remote-push-store.js";

const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const REQUEST_TIMEOUT_MS = 10_000;
const RECEIPT_CHECK_DELAY_MS = 15 * 60_000;
const MAX_DELIVERY_ATTEMPTS = 12;
const DEFAULT_DELIVERY_LIMIT = 25;

type ExpoResult = {
  status?: unknown;
  id?: unknown;
  message?: unknown;
  details?: { error?: unknown };
};

type ExpoPushResponse = {
  data?: ExpoResult | ExpoResult[] | Record<string, ExpoResult>;
  errors?: Array<{ code?: unknown; message?: unknown }>;
};

type DeliveryOutcome =
  | { kind: "ticket"; ticketId: string }
  | { kind: "delivered" }
  | { kind: "retry"; errorCode: string; resend?: boolean }
  | { kind: "failed"; errorCode: string; deactivate?: boolean };

export async function deliverPendingRemotePushNotifications(options?: {
  fetchImpl?: typeof fetch;
  now?: () => number;
  limit?: number;
}): Promise<{
  sent: number;
  delivered: number;
  retried: number;
  failed: number;
}> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const now = options?.now ?? Date.now;
  const limit = Math.max(
    1,
    Math.min(options?.limit ?? DEFAULT_DELIVERY_LIMIT, 100),
  );
  const summary = { sent: 0, delivered: 0, retried: 0, failed: 0 };

  for (let processed = 0; processed < limit; processed++) {
    const delivery = await claimNextRemotePushDelivery({ now: now() });
    if (!delivery) break;

    if (delivery.attempts > MAX_DELIVERY_ATTEMPTS) {
      await failRemotePushDelivery({
        id: delivery.id,
        phase: delivery.phase,
        errorCode: "attempts_exhausted",
      });
      summary.failed++;
      continue;
    }

    let outcome: DeliveryOutcome;
    try {
      outcome =
        delivery.phase === "receipt"
          ? await readExpoPushReceipt(delivery, fetchImpl)
          : await sendExpoPushNotification(delivery, fetchImpl);
    } catch (error) {
      outcome = {
        kind: "retry",
        errorCode: classifyTransportError(error),
      };
    }

    if (outcome.kind === "ticket") {
      await markRemotePushTicketAccepted({
        id: delivery.id,
        providerTicketId: outcome.ticketId,
        checkAfter: now() + RECEIPT_CHECK_DELAY_MS,
      });
      summary.sent++;
      continue;
    }
    if (outcome.kind === "delivered") {
      await markRemotePushDelivered(delivery.id);
      summary.delivered++;
      continue;
    }
    if (outcome.kind === "failed") {
      await failRemotePushDelivery({
        id: delivery.id,
        phase: delivery.phase,
        errorCode: outcome.errorCode,
      });
      if (outcome.deactivate) {
        await deactivateRemotePushRegistration(delivery.registrationId);
      }
      summary.failed++;
      continue;
    }

    await retryRemotePushDelivery({
      id: delivery.id,
      phase: delivery.phase,
      retryAt: now() + retryDelayMs(delivery.attempts),
      errorCode: outcome.errorCode,
      resend: outcome.resend,
    });
    summary.retried++;
  }

  return summary;
}

async function sendExpoPushNotification(
  delivery: ClaimedRemotePushDelivery,
  fetchImpl: typeof fetch,
): Promise<DeliveryOutcome> {
  if (delivery.provider !== "expo" || !isExpoPushToken(delivery.token)) {
    return {
      kind: "failed",
      errorCode: "unsupported_push_registration",
      deactivate: true,
    };
  }

  const response = await fetchWithTimeout(
    fetchImpl,
    EXPO_PUSH_SEND_URL,
    expoRequestInit(buildExpoMessage(delivery)),
  );
  const body = await readExpoResponse(response);
  if (!response.ok) return responseFailure(response.status, body);

  const ticket = Array.isArray(body.data) ? body.data[0] : body.data;
  if (!ticket || Array.isArray(ticket) || !isExpoResult(ticket)) {
    return { kind: "retry", errorCode: "invalid_push_ticket" };
  }
  if (ticket.status === "ok" && typeof ticket.id === "string") {
    return { kind: "ticket", ticketId: ticket.id };
  }
  return expoResultFailure(ticket, false);
}

async function readExpoPushReceipt(
  delivery: ClaimedRemotePushDelivery,
  fetchImpl: typeof fetch,
): Promise<DeliveryOutcome> {
  if (!delivery.providerTicketId) {
    return { kind: "retry", errorCode: "missing_push_ticket", resend: true };
  }
  const response = await fetchWithTimeout(
    fetchImpl,
    EXPO_PUSH_RECEIPTS_URL,
    expoRequestInit({ ids: [delivery.providerTicketId] }),
  );
  const body = await readExpoResponse(response);
  if (!response.ok) return responseFailure(response.status, body);

  const receipts = body.data;
  if (!receipts || Array.isArray(receipts) || isExpoResult(receipts)) {
    return { kind: "retry", errorCode: "push_receipt_unavailable" };
  }
  const receipt = receipts[delivery.providerTicketId];
  if (!receipt) {
    return { kind: "retry", errorCode: "push_receipt_unavailable" };
  }
  if (receipt.status === "ok") return { kind: "delivered" };
  return expoResultFailure(receipt, true);
}

function buildExpoMessage(delivery: ClaimedRemotePushDelivery) {
  const payload = readRecord(delivery.payload);
  const title = boundedString(payload?.title, 120) ?? "Agent Native update";
  const body = boundedString(payload?.body, 300);
  const data = compactData(payload);
  return {
    to: delivery.token,
    title,
    ...(body ? { body } : {}),
    sound: "default",
    priority: "high",
    data: {
      url: "agentnative://sessions",
      ...data,
    },
  };
}

function compactData(payload: Record<string, unknown> | null) {
  if (!payload) return {};
  const data: Record<string, string | number> = {};
  for (const key of ["commandId", "hostId", "kind", "status"] as const) {
    const value = boundedString(payload[key], 200);
    if (value) data[key] = value;
  }
  if (
    typeof payload.updatedAt === "number" &&
    Number.isFinite(payload.updatedAt)
  ) {
    data.updatedAt = payload.updatedAt;
  }
  return data;
}

function expoRequestInit(body: unknown): RequestInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return { method: "POST", headers, body: JSON.stringify(body) };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readExpoResponse(response: Response): Promise<ExpoPushResponse> {
  const body = await response.json().catch(() => null);
  return (readRecord(body) ?? {}) as ExpoPushResponse;
}

function responseFailure(
  status: number,
  body: ExpoPushResponse,
): DeliveryOutcome {
  const code = boundedString(body.errors?.[0]?.code, 120);
  if (status === 429 || status >= 500) {
    return { kind: "retry", errorCode: code ?? `expo_http_${status}` };
  }
  return { kind: "failed", errorCode: code ?? `expo_http_${status}` };
}

function expoResultFailure(
  result: ExpoResult,
  fromReceipt: boolean,
): DeliveryOutcome {
  const code = boundedString(result.details?.error, 120) ?? "expo_push_error";
  if (code === "DeviceNotRegistered") {
    return { kind: "failed", errorCode: code, deactivate: true };
  }
  if (code === "MessageRateExceeded") {
    return { kind: "retry", errorCode: code, resend: fromReceipt };
  }
  return { kind: "failed", errorCode: code };
}

function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

function classifyTransportError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "expo_request_timeout";
  }
  return "expo_transport_error";
}

function isExpoPushToken(value: string): boolean {
  return /^(Expo(nent)?PushToken)\[[A-Za-z0-9_-]+\]$/.test(value);
}

function isExpoResult(value: object): value is ExpoResult {
  return "status" in value;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
