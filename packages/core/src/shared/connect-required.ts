/**
 * The result shape a tool returns when it stopped because an integration is
 * not connected.
 *
 * Chat renders a Connect control by matching this shape, not by knowing the
 * tool's name, so a new gated tool gets the affordance without being added to
 * an allow-list. `message` is also the only text the model sees, which is why
 * the builder below composes the next step into it: a reason with no next step
 * is exactly the dead-end prose this contract exists to prevent.
 */
export interface ConnectRequiredCard {
  /** Stable provider id, e.g. `builder`. */
  provider: string;
  /** Display name shown on the Connect control, e.g. `Builder.io`. */
  providerLabel: string;
  /** Why the tool stopped, with no next step. Kept separate for UIs that render their own action. */
  reason: string;
  /** `reason` plus the next step. Safe to show a user and to paraphrase. */
  message: string;
  /** Direct connect/OAuth URL when the server already resolved one. */
  connectUrl?: string;
  /** In-app route that owns this connection, e.g. `/settings`. */
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

/**
 * Build the payload a gated tool spreads into its own result:
 * `{ ...ownFields, ...connectRequiredResult({ ... }) }`.
 */
export function connectRequiredResult(input: {
  provider: string;
  providerLabel: string;
  reason: string;
  connectUrl?: string | null;
  settingsPath?: string | null;
}): ConnectRequiredResult {
  const reason = input.reason.trim();
  const providerLabel = input.providerLabel.trim();
  const connectUrl = optionalString(input.connectUrl);
  const settingsPath = optionalString(input.settingsPath);
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

/** Read the card back out of an arbitrary tool result. */
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
  return {
    provider,
    providerLabel,
    reason,
    message,
    ...(optionalString(card.connectUrl)
      ? { connectUrl: optionalString(card.connectUrl)! }
      : {}),
    ...(optionalString(card.settingsPath)
      ? { settingsPath: optionalString(card.settingsPath)! }
      : {}),
  };
}
