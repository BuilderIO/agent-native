import {
  parseRemoteDevicePairing,
  type RemoteDevicePairing,
} from "./remote-device";
import { normalizeDispatchBaseUrl } from "./settings";

export const BROWSER_CHAT_SESSION_MESSAGE_TYPE =
  "browser-chat.session.v1" as const;
export const PENDING_PAIRING_KEY = "agentNativePendingBrowserChatPairing";
export const BROWSER_CHAT_SESSION_KEY = "agentNativeBrowserChatSession";
export const PAIRING_TTL_MS = 2 * 60 * 1_000;
export const MAX_SESSION_EXPIRY_MS = 2 * 60 * 1_000;

export interface PendingBrowserChatPairing {
  nonce: string;
  dispatchOrigin: string;
  createdAt: number;
}

export interface BrowserChatSession {
  nonce: string;
  dispatchOrigin: string;
  startUrl: string;
  expiresAt: string;
  receivedAt: number;
}

export interface AcceptedBrowserChatPairing {
  session: BrowserChatSession;
  remote: RemoteDevicePairing;
}

interface BrowserChatSessionMessage {
  type: typeof BROWSER_CHAT_SESSION_MESSAGE_TYPE;
  nonce: string;
  startPath: string;
  dispatchOrigin: string;
  expiresAt: string;
  remote: RemoteDevicePairing;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function senderOrigin(sender: chrome.runtime.MessageSender): string | null {
  const rawOrigin =
    typeof sender.origin === "string" ? sender.origin : sender.url;
  if (!rawOrigin) return null;
  try {
    return new URL(rawOrigin).origin;
  } catch {
    return null;
  }
}

function parseNonce(value: unknown): string | null {
  return typeof value === "string" &&
    value.length >= 24 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value)
    ? value
    : null;
}

function parseSessionMessage(value: unknown): BrowserChatSessionMessage | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 7 ||
    !keys.every((key) =>
      [
        "type",
        "nonce",
        "startPath",
        "dispatchOrigin",
        "expiresAt",
        "remoteDevice",
        "relayBaseUrl",
      ].includes(key),
    ) ||
    value.type !== BROWSER_CHAT_SESSION_MESSAGE_TYPE
  ) {
    return null;
  }
  const nonce = parseNonce(value.nonce);
  const dispatchOrigin = normalizeDispatchBaseUrl(value.dispatchOrigin);
  if (
    !nonce ||
    !dispatchOrigin ||
    new URL(dispatchOrigin).origin !== dispatchOrigin
  )
    return null;
  if (typeof value.startPath !== "string" || value.startPath.length > 16_384)
    return null;
  if (
    typeof value.expiresAt !== "string" ||
    value.expiresAt.length > 64 ||
    !Number.isFinite(Date.parse(value.expiresAt))
  ) {
    return null;
  }
  const remote = parseRemoteDevicePairing(
    value.remoteDevice,
    value.relayBaseUrl,
  );
  if (!remote) return null;
  return {
    type: BROWSER_CHAT_SESSION_MESSAGE_TYPE,
    nonce,
    startPath: value.startPath,
    dispatchOrigin,
    expiresAt: value.expiresAt,
    remote,
  };
}

function resolveStartUrl(
  startPath: string,
  dispatchOrigin: string,
): string | null {
  if (!startPath.startsWith("/") || startPath.startsWith("//")) return null;
  try {
    const url = new URL(startPath, dispatchOrigin);
    return url.origin === dispatchOrigin &&
      !url.username &&
      !url.password &&
      url.protocol === new URL(dispatchOrigin).protocol
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function acceptBrowserChatSession(
  value: unknown,
  sender: chrome.runtime.MessageSender,
  pending: PendingBrowserChatPairing | null,
  now = Date.now(),
): AcceptedBrowserChatPairing | null {
  const message = parseSessionMessage(value);
  const origin = senderOrigin(sender);
  if (
    !message ||
    !pending ||
    !origin ||
    now - pending.createdAt < 0 ||
    now - pending.createdAt > PAIRING_TTL_MS ||
    message.nonce !== pending.nonce ||
    message.dispatchOrigin !== pending.dispatchOrigin ||
    origin !== pending.dispatchOrigin ||
    Date.parse(message.expiresAt) <= now ||
    Date.parse(message.expiresAt) > now + MAX_SESSION_EXPIRY_MS
  ) {
    return null;
  }
  const startUrl = resolveStartUrl(message.startPath, pending.dispatchOrigin);
  return startUrl
    ? {
        session: {
          nonce: pending.nonce,
          dispatchOrigin: pending.dispatchOrigin,
          startUrl,
          expiresAt: message.expiresAt,
          receivedAt: now,
        },
        remote: message.remote,
      }
    : null;
}

export async function beginBrowserChatPairing(
  dispatchBaseUrl: string,
): Promise<{ nonce: string; connectUrl: string }> {
  const normalized = normalizeDispatchBaseUrl(dispatchBaseUrl);
  if (!normalized) throw new Error("Invalid Dispatch base URL.");
  const dispatchOrigin = new URL(normalized).origin;
  const nonce = createNonce();
  const pending: PendingBrowserChatPairing = {
    nonce,
    dispatchOrigin,
    createdAt: Date.now(),
  };
  await chrome.storage.session.set({ [PENDING_PAIRING_KEY]: pending });
  await chrome.storage.session.remove(BROWSER_CHAT_SESSION_KEY);

  const url = new URL(`${normalized}/browser-connect`);
  url.searchParams.set("extensionId", chrome.runtime.id);
  url.searchParams.set("nonce", nonce);
  return { nonce, connectUrl: url.toString() };
}

export async function readBrowserChatSession(
  now = Date.now(),
): Promise<BrowserChatSession | null> {
  const stored = await chrome.storage.session.get(BROWSER_CHAT_SESSION_KEY);
  const session = stored[BROWSER_CHAT_SESSION_KEY];
  if (!isRecord(session)) return null;
  const nonce = parseNonce(session.nonce);
  const dispatchOrigin = normalizeDispatchBaseUrl(session.dispatchOrigin);
  const startUrl =
    typeof session.startUrl === "string" ? session.startUrl : undefined;
  const receivedAt =
    typeof session.receivedAt === "number" ? session.receivedAt : undefined;
  const expiresAt =
    typeof session.expiresAt === "string" ? session.expiresAt : undefined;
  if (
    !nonce ||
    !dispatchOrigin ||
    !startUrl ||
    !expiresAt ||
    typeof receivedAt !== "number" ||
    !Number.isFinite(receivedAt) ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    Date.parse(expiresAt) <= now ||
    Date.parse(expiresAt) > now + MAX_SESSION_EXPIRY_MS ||
    new URL(dispatchOrigin).origin !== dispatchOrigin
  ) {
    await chrome.storage.session.remove(BROWSER_CHAT_SESSION_KEY);
    return null;
  }
  try {
    if (new URL(startUrl).origin !== dispatchOrigin) {
      await chrome.storage.session.remove(BROWSER_CHAT_SESSION_KEY);
      return null;
    }
    return { nonce, dispatchOrigin, startUrl, expiresAt, receivedAt };
  } catch {
    await chrome.storage.session.remove(BROWSER_CHAT_SESSION_KEY);
    return null;
  }
}

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
