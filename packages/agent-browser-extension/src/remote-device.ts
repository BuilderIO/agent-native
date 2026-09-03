export const REMOTE_DEVICE_CONFIG_KEY =
  "agentNativeBrowserRemoteDevice" as const;

export interface PairedRemoteDevice {
  id: string;
  token?: string;
}

export interface RemoteDeviceConfig {
  deviceId: string;
  token: string;
  relayBaseUrl: string;
  dispatchOrigin: string;
  updatedAt: string;
}

export interface RemoteDevicePairing {
  remoteDevice: PairedRemoteDevice;
  relayBaseUrl: string;
}

export function parseRemoteDevicePairing(
  remoteDeviceValue: unknown,
  relayBaseUrlValue: unknown,
): RemoteDevicePairing | null {
  if (!isRecord(remoteDeviceValue)) return null;
  const keys = Object.keys(remoteDeviceValue);
  if (
    keys.length < 1 ||
    keys.length > 2 ||
    !keys.every((key) => key === "id" || key === "token")
  ) {
    return null;
  }
  const id = boundedText(remoteDeviceValue.id, 256);
  const token =
    remoteDeviceValue.token === undefined
      ? undefined
      : boundedText(remoteDeviceValue.token, 2_048);
  const relayBaseUrl = normalizeRelayBaseUrl(relayBaseUrlValue);
  if (!id || !relayBaseUrl || (remoteDeviceValue.token !== undefined && !token))
    return null;
  return {
    remoteDevice: { id, ...(token ? { token } : {}) },
    relayBaseUrl,
  };
}

export function normalizeRelayBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 16_384) return null;
  try {
    const url = new URL(value.trim());
    const loopback =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function remoteHostPattern(value: string): string | null {
  const normalized = normalizeRelayBaseUrl(value);
  return normalized ? `${new URL(normalized).origin}/*` : null;
}

export function mergeRemoteDeviceConfig(
  pairing: RemoteDevicePairing,
  dispatchOrigin: string,
  previous: RemoteDeviceConfig | null,
  now = Date.now(),
): RemoteDeviceConfig | null {
  const sameDevice =
    previous?.deviceId === pairing.remoteDevice.id &&
    previous.relayBaseUrl === pairing.relayBaseUrl &&
    previous.dispatchOrigin === dispatchOrigin;
  const token =
    pairing.remoteDevice.token ?? (sameDevice ? previous.token : "");
  if (!token) return null;
  return {
    deviceId: pairing.remoteDevice.id,
    token,
    relayBaseUrl: pairing.relayBaseUrl,
    dispatchOrigin,
    updatedAt: new Date(now).toISOString(),
  };
}

export async function readRemoteDeviceConfig(): Promise<RemoteDeviceConfig | null> {
  const stored = await chrome.storage.local.get(REMOTE_DEVICE_CONFIG_KEY);
  return parseStoredRemoteDeviceConfig(stored[REMOTE_DEVICE_CONFIG_KEY]);
}

export async function saveRemoteDeviceConfig(
  config: RemoteDeviceConfig,
): Promise<void> {
  await chrome.storage.local.set({ [REMOTE_DEVICE_CONFIG_KEY]: config });
}

export async function hasRemoteHostAccess(
  relayBaseUrl: string,
): Promise<boolean> {
  const origin = remoteHostPattern(relayBaseUrl);
  return origin
    ? chrome.permissions.contains({ origins: [origin] })
    : Promise.resolve(false);
}

export async function requestRemoteHostAccess(
  relayBaseUrl: string,
): Promise<boolean> {
  const origin = remoteHostPattern(relayBaseUrl);
  return origin
    ? chrome.permissions.request({ origins: [origin] })
    : Promise.resolve(false);
}

function parseStoredRemoteDeviceConfig(
  value: unknown,
): RemoteDeviceConfig | null {
  if (!isRecord(value)) return null;
  const deviceId = boundedText(value.deviceId, 256);
  const token = boundedText(value.token, 2_048);
  const relayBaseUrl = normalizeRelayBaseUrl(value.relayBaseUrl);
  const dispatchOrigin = normalizeOrigin(value.dispatchOrigin);
  const updatedAt =
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt))
      ? value.updatedAt
      : null;
  return deviceId && token && relayBaseUrl && dispatchOrigin && updatedAt
    ? { deviceId, token, relayBaseUrl, dispatchOrigin, updatedAt }
    : null;
}

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.origin === value &&
      (url.protocol === "http:" || url.protocol === "https:")
      ? value
      : null;
  } catch {
    return null;
  }
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
