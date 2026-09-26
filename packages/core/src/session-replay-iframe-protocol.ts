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
