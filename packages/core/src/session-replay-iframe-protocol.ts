export const SESSION_REPLAY_IFRAME_ATTRIBUTE =
  "data-agent-native-session-replay";
export const SESSION_REPLAY_IFRAME_PROBE = "agent-native-session-replay:probe";
export const SESSION_REPLAY_IFRAME_START = "agent-native-session-replay:start";
export const SESSION_REPLAY_IFRAME_STOP = "agent-native-session-replay:stop";

export interface SessionReplayIframePrivacyOptions {
  blockSelector: string;
  ignoreSelector: string;
  maskTextClass?: string | RegExp;
  maskTextSelector: string;
  maskAllInputs: boolean;
  maskInputOptions?: Record<string, boolean>;
  recordCanvas: boolean;
  collectFonts: boolean;
  inlineImages: boolean;
  sampling: Record<string, unknown>;
}

export interface SessionReplayIframeProbeMessage {
  type: typeof SESSION_REPLAY_IFRAME_PROBE;
}

export interface SessionReplayIframeStartMessage {
  type: typeof SESSION_REPLAY_IFRAME_START;
  options: SessionReplayIframePrivacyOptions;
}

export interface SessionReplayIframeStopMessage {
  type: typeof SESSION_REPLAY_IFRAME_STOP;
}

export type SessionReplayIframeMessage =
  | SessionReplayIframeProbeMessage
  | SessionReplayIframeStartMessage
  | SessionReplayIframeStopMessage;

/**
 * `srcdoc` HTML came from the immediate parent, so that parent already owns the
 * document being rendered. Server-rendered extension URLs are stricter: only a
 * parent on the render URL's origin may activate recording. That supports
 * custom app domains without allowing an external embed host to make an opaque
 * extension frame disclose its DOM through rrweb's postMessage transport.
 */
export function isTrustedSessionReplayIframeParentOrigin(
  parentOrigin: string,
  frameHref: string,
): boolean {
  if (frameHref === "about:srcdoc") {
    return parentOrigin !== "null" && parentOrigin !== "";
  }
  try {
    const frameOrigin = new URL(frameHref).origin;
    return frameOrigin !== "null" && parentOrigin === frameOrigin;
  } catch {
    return false;
  }
}
