export const BROWSER_CONTROL_STATUS_KEY =
  "agentNativeBrowserControlStatus" as const;
export const BROWSER_CONTROL_STATUS_MAX_AGE_MS = 45_000;
const BROWSER_CONTROL_STATUS_MAX_FUTURE_SKEW_MS = 5_000;

export type BrowserControlStatus =
  | {
      state: "available";
      nativeHostConnected: true;
      activeTasks: number;
      updatedAt: string;
    }
  | {
      state: "unavailable";
      nativeHostConnected: false;
      activeTasks: 0;
      reason: "native-host-not-connected";
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
    status.nativeHostConnected === true &&
    typeof status.activeTasks === "number" &&
    Number.isInteger(status.activeTasks) &&
    status.activeTasks >= 0
  ) {
    return status as BrowserControlStatus;
  }
  if (
    status.state === "unavailable" &&
    status.nativeHostConnected === false &&
    status.activeTasks === 0 &&
    status.reason === "native-host-not-connected"
  ) {
    return status as BrowserControlStatus;
  }
  return null;
}
