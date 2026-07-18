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
  const claimedDeliveries: ClaimedRemotePushDelivery[] = [];

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

    claimedDeliveries.push(delivery);
  }

  const sendDeliveries = claimedDeliveries.filter(
    (delivery) => delivery.phase === "send",
  );
  if (sendDeliveries.length > 0) {
    let outcomes: DeliveryOutcome[];
    try {
      outcomes = await sendExpoPushNotifications(sendDeliveries, fetchImpl);
    } catch (error) {
      const errorCode = classifyTransportError(error);
      outcomes = sendDeliveries.map(() => ({ kind: "retry", errorCode }));
    }
    for (let index = 0; index < sendDeliveries.length; index++) {
      await applyDeliveryOutcome(
        sendDeliveries[index]!,
        outcomes[index]!,
        summary,
        now,
      );
    }
  }

  for (const delivery of claimedDeliveries) {
    if (delivery.phase !== "receipt") continue;
    let outcome: DeliveryOutcome;
    try {
      outcome = await readExpoPushReceipt(delivery, fetchImpl);
    } catch (error) {
      outcome = {
        kind: "retry",
        errorCode: classifyTransportError(error),
      };
    }

    await applyDeliveryOutcome(delivery, outcome, summary, now);
  }

  return summary;
}

async function applyDeliveryOutcome(
  delivery: ClaimedRemotePushDelivery,
  outcome: DeliveryOutcome,
  summary: {
    sent: number;
    delivered: number;
    retried: number;
    failed: number;
  },
  now: () => number,
): Promise<void> {
  if (outcome.kind === "ticket") {
    await markRemotePushTicketAccepted({
      id: delivery.id,
      providerTicketId: outcome.ticketId,
      checkAfter: now() + RECEIPT_CHECK_DELAY_MS,
    });
    summary.sent++;
    return;
  }
  if (outcome.kind === "delivered") {
    await markRemotePushDelivered(delivery.id);
    summary.delivered++;
    return;
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
    return;
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

async function sendExpoPushNotifications(
  deliveries: ClaimedRemotePushDelivery[],
  fetchImpl: typeof fetch,
): Promise<DeliveryOutcome[]> {
  const outcomes = new Map<string, DeliveryOutcome>();
  const supportedDeliveries = deliveries.filter((delivery) => {
    const supported =
      delivery.provider === "expo" && isExpoPushToken(delivery.token);
    if (!supported) {
      outcomes.set(delivery.id, {
        kind: "failed",
        errorCode: "unsupported_push_registration",
        deactivate: true,
      });
    }
    return supported;
  });
  if (supportedDeliveries.length === 0) {
    return deliveries.map((delivery) => outcomes.get(delivery.id)!);
  }

  const messages = supportedDeliveries.map(buildExpoMessage);
  const response = await fetchWithTimeout(
    fetchImpl,
    EXPO_PUSH_SEND_URL,
    expoRequestInit(messages.length === 1 ? messages[0] : messages),
  );
  const body = await readExpoResponse(response);
  if (!response.ok) {
    const outcome = responseFailure(response.status, body);
    for (const delivery of supportedDeliveries) {
      outcomes.set(delivery.id, outcome);
    }
    return deliveries.map((delivery) => outcomes.get(delivery.id)!);
  }

  const tickets = Array.isArray(body.data)
    ? body.data
    : body.data && isExpoResult(body.data)
      ? [body.data]
      : [];
  if (tickets.length !== supportedDeliveries.length) {
    for (const delivery of supportedDeliveries) {
      outcomes.set(delivery.id, {
        kind: "retry",
        errorCode: "invalid_push_ticket",
      });
    }
    return deliveries.map((delivery) => outcomes.get(delivery.id)!);
  }

  for (let index = 0; index < supportedDeliveries.length; index++) {
    const delivery = supportedDeliveries[index]!;
    const ticket = tickets[index]!;
    outcomes.set(
      delivery.id,
      ticket.status === "ok" && typeof ticket.id === "string"
        ? { kind: "ticket", ticketId: ticket.id }
        : expoResultFailure(ticket, false),
    );
  }
  return deliveries.map((delivery) => outcomes.get(delivery.id)!);
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
