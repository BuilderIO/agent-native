export const EMBED_SESSION_EXPIRED_MESSAGE = "agentNative.embedSessionExpired";

interface EmbedSessionExpiredMessage {
  type?: unknown;
  embedStartUrl?: unknown;
}

export function isEmbedSessionExpiredMessage(
  event: Pick<MessageEvent, "data" | "source">,
  frame: Pick<HTMLIFrameElement, "contentWindow" | "src"> | null,
  expectedStartUrl?: string | null,
): boolean {
  const data =
    event.data && typeof event.data === "object"
      ? (event.data as EmbedSessionExpiredMessage)
      : null;
  if (data?.type !== EMBED_SESSION_EXPIRED_MESSAGE) return false;

  const frameWindow = frame?.contentWindow;
  if (frameWindow && event.source === frameWindow) return true;
  if (event.source !== null) return false;
  if (typeof data.embedStartUrl !== "string") return false;

  const frameUrl = frame?.src || expectedStartUrl;
  return Boolean(frameUrl && data.embedStartUrl === frameUrl);
}
