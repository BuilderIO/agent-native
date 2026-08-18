export const SUBSCRIPTION_PROVIDER_IDS = ["codex", "claude"] as const;
export type SubscriptionProviderId = (typeof SUBSCRIPTION_PROVIDER_IDS)[number];

export const SUBSCRIPTION_CONNECTION_STATES = [
  "connected",
  "needs-sign-in",
  "unavailable",
  "error",
] as const;
export type SubscriptionConnectionState =
  (typeof SUBSCRIPTION_CONNECTION_STATES)[number];

export const SUBSCRIPTION_TELEMETRY_STATES = [
  "live",
  "stale",
  "unavailable",
  "unsupported",
  "error",
] as const;
export type SubscriptionTelemetryState =
  (typeof SUBSCRIPTION_TELEMETRY_STATES)[number];

export const SUBSCRIPTION_METER_KINDS = [
  "five-hour",
  "weekly",
  "model-tier-weekly",
] as const;
export type SubscriptionMeterKind = (typeof SUBSCRIPTION_METER_KINDS)[number];

export const SUBSCRIPTION_VALUE_STATES = [
  "available",
  "unavailable",
  "unsupported",
  "error",
] as const;
export type SubscriptionValueState = (typeof SUBSCRIPTION_VALUE_STATES)[number];

export const SUBSCRIPTION_TELEMETRY_SOURCES = [
  "codex-app-server",
  "claude-status-line",
  "connection-only",
] as const;
export type SubscriptionTelemetrySource =
  (typeof SUBSCRIPTION_TELEMETRY_SOURCES)[number];

export interface SubscriptionPlan {
  type?: string;
  label?: string;
}

export interface SubscriptionTelemetryCapabilities {
  account: boolean;
  plan: boolean;
  rateLimits: boolean;
  modelTierRateLimits: boolean;
  contextWindow: boolean;
  credits: boolean;
  liveUpdates: boolean;
}

export interface SubscriptionRateLimitMeter {
  id: string;
  kind: SubscriptionMeterKind;
  state: SubscriptionValueState;
  label?: string;
  modelTier?: string;
  usedPercent?: number;
  windowDurationMinutes?: number;
  resetsAt?: string;
  message?: string;
}

export interface SubscriptionCredits {
  state: SubscriptionValueState;
  hasCredits?: boolean;
  unlimited?: boolean;
  balance?: number | string;
  used?: number;
  limit?: number;
  unit?: string;
  currency?: string;
  message?: string;
}

export interface SubscriptionContextWindow {
  state: SubscriptionValueState;
  usedTokens?: number;
  maxTokens?: number;
  usedPercent?: number;
  message?: string;
}

export interface SubscriptionTelemetryError {
  message: string;
  code?: string;
}

export interface SubscriptionTelemetry {
  state: SubscriptionTelemetryState;
  source: SubscriptionTelemetrySource;
  updatedAt?: string;
  staleAt?: string;
  sourceVersion?: string;
  capabilities: SubscriptionTelemetryCapabilities;
  meters: SubscriptionRateLimitMeter[];
  contextWindow?: SubscriptionContextWindow;
  credits?: SubscriptionCredits;
  error?: SubscriptionTelemetryError;
}

export interface SubscriptionStatus {
  schemaVersion: 1;
  providerId: SubscriptionProviderId;
  connectionState: SubscriptionConnectionState;
  authMethod?: string;
  plan?: SubscriptionPlan;
  connectionMessage?: string;
  telemetry: SubscriptionTelemetry;
}

const EMPTY_CAPABILITIES: SubscriptionTelemetryCapabilities = {
  account: false,
  plan: false,
  rateLimits: false,
  modelTierRateLimits: false,
  contextWindow: false,
  credits: false,
  liveUpdates: false,
};

export function normalizeSubscriptionStatus(
  value: unknown,
): SubscriptionStatus | null {
  const input = asRecord(value);
  if (!input || input.schemaVersion !== 1) return null;
  const providerId = readEnum(input.providerId, SUBSCRIPTION_PROVIDER_IDS);
  if (!providerId) return null;

  const telemetryInput = asRecord(input.telemetry);
  const telemetryState =
    readEnum(telemetryInput?.state, SUBSCRIPTION_TELEMETRY_STATES) ??
    "unavailable";
  const source =
    readEnum(telemetryInput?.source, SUBSCRIPTION_TELEMETRY_SOURCES) ??
    "connection-only";
  const meterInputs = Array.isArray(telemetryInput?.meters)
    ? telemetryInput.meters
    : [];
  const meters = meterInputs
    .map((meter, index) => normalizeMeter(meter, index))
    .filter((meter): meter is SubscriptionRateLimitMeter => meter !== null);
  const plan = normalizePlan(input.plan);
  const updatedAt = readIsoTimestamp(telemetryInput?.updatedAt);
  const contextWindow = normalizeContextWindow(telemetryInput?.contextWindow);
  const credits = normalizeCredits(telemetryInput?.credits);

  const status: SubscriptionStatus = {
    schemaVersion: 1,
    providerId,
    connectionState:
      readEnum(input.connectionState, SUBSCRIPTION_CONNECTION_STATES) ??
      "unavailable",
    telemetry: {
      state: telemetryState,
      source,
      capabilities: deriveCapabilities({
        hasPlan: Boolean(plan),
        meters,
        contextWindow,
        credits,
        telemetryState,
        updatedAt,
      }),
      meters,
    },
  };

  assignString(status, "authMethod", input.authMethod);
  assignString(status, "connectionMessage", input.connectionMessage);
  if (plan) status.plan = plan;

  if (updatedAt) status.telemetry.updatedAt = updatedAt;
  assignTimestamp(status.telemetry, "staleAt", telemetryInput?.staleAt);
  assignString(
    status.telemetry,
    "sourceVersion",
    telemetryInput?.sourceVersion,
  );
  if (contextWindow) status.telemetry.contextWindow = contextWindow;
  if (credits) status.telemetry.credits = credits;
  const error = normalizeError(telemetryInput?.error);
  if (error) status.telemetry.error = error;
  return status;
}

function deriveCapabilities(input: {
  hasPlan: boolean;
  meters: readonly SubscriptionRateLimitMeter[];
  contextWindow?: SubscriptionContextWindow;
  credits?: SubscriptionCredits;
  telemetryState: SubscriptionTelemetryState;
  updatedAt?: string;
}): SubscriptionTelemetryCapabilities {
  return {
    ...EMPTY_CAPABILITIES,
    account: false,
    plan: input.hasPlan,
    rateLimits: input.meters.some(
      (meter) => meter.kind === "five-hour" || meter.kind === "weekly",
    ),
    modelTierRateLimits: input.meters.some(
      (meter) => meter.kind === "model-tier-weekly",
    ),
    contextWindow: Boolean(input.contextWindow),
    credits: Boolean(input.credits),
    liveUpdates: input.telemetryState === "live" && Boolean(input.updatedAt),
  };
}

function normalizeMeter(
  value: unknown,
  index: number,
): SubscriptionRateLimitMeter | null {
  const input = asRecord(value);
  if (!input) return null;
  const kind = readEnum(input.kind, SUBSCRIPTION_METER_KINDS);
  if (!kind) return null;
  const usedPercent = readFiniteNumber(input.usedPercent, 0, 100);
  const requestedState = readEnum(input.state, SUBSCRIPTION_VALUE_STATES);
  const state =
    requestedState === "available" && usedPercent === undefined
      ? "unavailable"
      : (requestedState ??
        (usedPercent === undefined ? "unavailable" : "available"));
  const meter: SubscriptionRateLimitMeter = {
    id: readString(input.id) ?? `${kind}-${index + 1}`,
    kind,
    state,
  };

  assignString(meter, "label", input.label);
  assignString(meter, "modelTier", input.modelTier);
  assignTimestamp(meter, "resetsAt", input.resetsAt);
  assignString(meter, "message", input.message);
  if (state === "available" && usedPercent !== undefined) {
    meter.usedPercent = usedPercent;
  }
  const duration = readFiniteNumber(input.windowDurationMinutes, 1);
  if (duration !== undefined) meter.windowDurationMinutes = duration;
  return meter;
}

function normalizeCredits(value: unknown): SubscriptionCredits | undefined {
  const input = asRecord(value);
  if (!input) return undefined;
  const hasCredits = readBoolean(input.hasCredits);
  const unlimited = readBoolean(input.unlimited);
  const balance = readBalance(input.balance);
  const used = readFiniteNumber(input.used, 0);
  const limit = readFiniteNumber(input.limit, 0);
  const requestedState = readEnum(input.state, SUBSCRIPTION_VALUE_STATES);
  const hasReportedValue =
    hasCredits !== undefined ||
    unlimited !== undefined ||
    balance !== undefined ||
    used !== undefined ||
    limit !== undefined;
  const state =
    requestedState === "available" && !hasReportedValue
      ? "unavailable"
      : (requestedState ?? (hasReportedValue ? "available" : "unavailable"));
  const credits: SubscriptionCredits = { state };

  if (hasCredits !== undefined) credits.hasCredits = hasCredits;
  if (unlimited !== undefined) credits.unlimited = unlimited;
  if (state === "available" && balance !== undefined) credits.balance = balance;
  if (state === "available" && used !== undefined) credits.used = used;
  if (state === "available" && limit !== undefined) credits.limit = limit;
  assignString(credits, "unit", input.unit);
  assignString(credits, "currency", input.currency);
  assignString(credits, "message", input.message);
  return credits;
}

function normalizeContextWindow(
  value: unknown,
): SubscriptionContextWindow | undefined {
  const input = asRecord(value);
  if (!input) return undefined;
  const usedTokens = readFiniteNumber(input.usedTokens, 0);
  const maxTokens = readFiniteNumber(input.maxTokens, 1);
  const usedPercent = readFiniteNumber(input.usedPercent, 0, 100);
  const requestedState = readEnum(input.state, SUBSCRIPTION_VALUE_STATES);
  const hasReportedValue =
    usedTokens !== undefined ||
    maxTokens !== undefined ||
    usedPercent !== undefined;
  const state =
    requestedState === "available" && !hasReportedValue
      ? "unavailable"
      : (requestedState ?? (hasReportedValue ? "available" : "unavailable"));
  const context: SubscriptionContextWindow = { state };

  if (state === "available") {
    if (usedTokens !== undefined) context.usedTokens = usedTokens;
    if (maxTokens !== undefined) context.maxTokens = maxTokens;
    if (usedPercent !== undefined) context.usedPercent = usedPercent;
  }
  assignString(context, "message", input.message);
  return context;
}

function normalizePlan(value: unknown): SubscriptionPlan | undefined {
  const input = asRecord(value);
  if (!input) return undefined;
  const plan: SubscriptionPlan = {};
  assignString(plan, "type", input.type);
  assignString(plan, "label", input.label);
  return Object.keys(plan).length > 0 ? plan : undefined;
}

function normalizeError(
  value: unknown,
): SubscriptionTelemetryError | undefined {
  const input = asRecord(value);
  const message = readString(input?.message);
  if (!message) return undefined;
  const error: SubscriptionTelemetryError = { message };
  assignString(error, "code", input?.code);
  return error;
}

function readBalance(value: unknown): number | string | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  return readString(value);
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readFiniteNumber(
  value: unknown,
  min: number,
  max = Number.POSITIVE_INFINITY,
): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : undefined;
}

function assignString<T extends object, K extends keyof T & string>(
  target: T,
  key: K,
  value: unknown,
): void {
  const normalized = readString(value);
  if (normalized !== undefined) target[key] = normalized as T[K];
}

function assignTimestamp<T extends object, K extends keyof T & string>(
  target: T,
  key: K,
  value: unknown,
): void {
  const normalized = readIsoTimestamp(value);
  if (normalized !== undefined) target[key] = normalized as T[K];
}

function readIsoTimestamp(value: unknown): string | undefined {
  const parsed = (() => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.abs(value) < 100_000_000_000 ? value * 1_000 : value;
    }
    if (typeof value !== "string") return Number.NaN;
    const trimmed = value.trim();
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        trimmed,
      )
    ) {
      return Number.NaN;
    }
    return Date.parse(trimmed);
  })();
  if (!Number.isFinite(parsed)) return undefined;
  const date = new Date(parsed);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
