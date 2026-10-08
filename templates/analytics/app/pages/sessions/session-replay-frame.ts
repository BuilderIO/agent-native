import { SESSION_REPLAY_AGENT_ACCESS_PARAM } from "@shared/session-replay-agent-access";

/**
 * Frame mode: `/sessions/:id?frame=1&agent_access=<token>` renders one
 * recording with no app chrome and no login, so a headless browser holding a
 * tokenized replay link can seek to an offset and screenshot it. The signed
 * token is the only credential; the replay data endpoints verify it.
 */
export const REPLAY_FRAME_QUERY_PARAM = "frame";

// `events` and `performance` are their own Sessions pages, not recordings.
const SESSION_DETAIL_PATH =
  /^\/sessions\/(?!(?:events|performance)\/?$)[^/]+\/?$/;

export function isReplayFrameRequest(
  pathname: string,
  search: string,
): boolean {
  if (!SESSION_DETAIL_PATH.test(pathname)) return false;
  const params = new URLSearchParams(search);
  return (
    params.get(REPLAY_FRAME_QUERY_PARAM) === "1" &&
    Boolean(params.get(SESSION_REPLAY_AGENT_ACCESS_PARAM))
  );
}

export type ReplayFrameCapture = {
  offsetMs: number;
  width: number;
  height: number;
  /** Path the recording was on at this offset; empty when it cannot be told. */
  route: string;
  capturedAt: string;
  /** PNG bytes, base64 encoded. */
  png: string;
};

/**
 * A recorded route reduced to its path. The query and hash of a recorded URL
 * can carry codes or personal data, and a capture manifest is meant to be
 * shared.
 */
export function replayFramePath(route: string): string {
  return route.split(/[?#]/, 1)[0] ?? "";
}

/** What a driver reads from `window.__anReplayFrame`. */
export type ReplayFrameApi =
  | { status: "loading" }
  | { status: "error"; reason: string }
  | {
      status: "ready";
      recordingId: string;
      totalTimeMs: number;
      eventCount: number;
      capture(offsetMs: number): Promise<ReplayFrameCapture>;
    };

declare global {
  interface Window {
    __anReplayFrame?: ReplayFrameApi;
  }
}

/** A stable reason string for a driver to report; never a stack or a URL. */
export function replayFrameFailureReason(error: unknown): string {
  // By name, so the root route can import this file without the screenshot
  // compositor.
  if (error instanceof Error && error.name === "ReplayScreenshotAssetError") {
    return "assets_not_capturable";
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 200) || "unknown_error";
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("screenshot_unreadable"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      if (!result.startsWith("data:") || comma === -1) {
        reject(new Error("screenshot_unreadable"));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}
