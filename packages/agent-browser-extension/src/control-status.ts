export const BROWSER_CONTROL_STATUS_KEY =
  "agentNativeBrowserControlStatus" as const;
export const BROWSER_CONTROL_STATUS_MAX_AGE_MS = 90_000;
const BROWSER_CONTROL_STATUS_MAX_FUTURE_SKEW_MS = 5_000;

export type BrowserControlStatus =
  | {
      state: "available";
      nativeHostConnected: boolean;
      relayConnected: boolean;
      controlTransport: "native" | "relay";
      activeTasks: number;
      updatedAt: string;
    }
  | {
      state: "unavailable";
      nativeHostConnected: false;
      relayConnected: false;
      controlTransport: null;
      activeTasks: 0;
      reason: "connection-not-configured" | "relay-not-connected";
      updatedAt: string;
    };

export function parseBrowserControlStatus(
  value: unknown,
  now = Date.now(),
): BrowserControlStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = value as Partial<BrowserControlStatus>;
  const updatedAt =
    typeof status.updatedAt === "string"
      ? Date.parse(status.updatedAt)
      : Number.NaN;
  if (
    !Number.isFinite(updatedAt) ||
    updatedAt < now - BROWSER_CONTROL_STATUS_MAX_AGE_MS ||
    updatedAt > now + BROWSER_CONTROL_STATUS_MAX_FUTURE_SKEW_MS
  ) {
    return null;
  }
  if (
    status.state === "available" &&
    typeof status.nativeHostConnected === "boolean" &&
    typeof status.relayConnected === "boolean" &&
    (status.controlTransport === "native" ||
      status.controlTransport === "relay") &&
    status.controlTransport ===
      (status.nativeHostConnected
        ? "native"
        : status.relayConnected
          ? "relay"
          : null) &&
    typeof status.activeTasks === "number" &&
    Number.isInteger(status.activeTasks) &&
    status.activeTasks >= 0
  ) {
    return status as BrowserControlStatus;
  }
  if (
    status.state === "unavailable" &&
    status.nativeHostConnected === false &&
    status.relayConnected === false &&
    status.controlTransport === null &&
    status.activeTasks === 0 &&
    (status.reason === "connection-not-configured" ||
      status.reason === "relay-not-connected")
  ) {
    return status as BrowserControlStatus;
  }
  return null;
}
