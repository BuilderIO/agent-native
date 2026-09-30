export interface ConnectRequiredCard {
  provider: string;
  providerLabel: string;
  reason: string;
  message: string;
  connectUrl?: string;
  settingsPath?: string;
}

export interface ConnectRequiredResult {
  connectRequired: ConnectRequiredCard;
}

export const BUILDER_CONNECT_PROVIDER = "builder";
export const BUILDER_CONNECT_PROVIDER_LABEL = "Builder.io";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeConnectHref(value: unknown): string | undefined {
  const raw = optionalString(value);
  if (!raw) return undefined;
  const href = raw.replace(/[\t\n\r]/g, "");
  if (!href) return undefined;
  if (/^[/\\]{2}/.test(href)) return undefined;
  if (href.startsWith("/")) return href;
  return /^https?:\/\//i.test(href) ? href : undefined;
}

export function connectRequiredResult(input: {
  provider: string;
  providerLabel: string;
  reason: string;
  connectUrl?: string | null;
  settingsPath?: string | null;
}): ConnectRequiredResult {
  const reason = input.reason.trim();
  const providerLabel = input.providerLabel.trim();
  const connectUrl = safeConnectHref(input.connectUrl);
  const settingsPath = safeConnectHref(input.settingsPath);
  return {
    connectRequired: {
      provider: input.provider,
      providerLabel,
      reason,
      message: `${reason} Connect ${providerLabel} to continue: use the Connect button shown here, or connect ${providerLabel} in Settings.`,
      ...(connectUrl ? { connectUrl } : {}),
      ...(settingsPath ? { settingsPath } : {}),
    },
  };
}

export function normalizeConnectRequiredResult(
  value: unknown,
): ConnectRequiredCard | null {
  if (!isRecord(value) || !isRecord(value.connectRequired)) return null;
  const card = value.connectRequired;
  const provider = optionalString(card.provider);
  const providerLabel = optionalString(card.providerLabel);
  const reason = optionalString(card.reason);
  const message = optionalString(card.message);
  if (!provider || !providerLabel || !reason || !message) return null;
  const connectUrl = safeConnectHref(card.connectUrl);
  const settingsPath = safeConnectHref(card.settingsPath);
  return {
    provider,
    providerLabel,
    reason,
    message,
    ...(connectUrl ? { connectUrl } : {}),
    ...(settingsPath ? { settingsPath } : {}),
  };
}
