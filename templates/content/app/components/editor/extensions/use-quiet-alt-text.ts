import {
  isAgentChatAiSetupRequiredError,
  requestAgentChatThreadOpen,
  startBackgroundAgentSession,
  type BackgroundAgentSessionHandle,
  type BackgroundAgentSessionStatus,
} from "@agent-native/core/client/agent-chat";
import { QUIET_ALT_TEXT_SCOPE_TYPE } from "@shared/quiet-agent-runs";
import { useCallback, useEffect, useRef, useState } from "react";

export type QuietAltTextState =
  | { phase: "idle" }
  | { phase: "running"; threadId: string }
  | { phase: "done"; threadId: string }
  | { phase: "kept" }
  | { phase: "failed"; reason: "setup" | "error"; threadId: string | null };

export interface QuietAltTextRequest {
  documentId: string;
  message: string;
  instructions: string;
  imageDataUrl: string | null;
  altAtStart: string;
}

const STATUS_POLL_MS = 2_000;
const STATUS_GIVE_UP_MS = 3 * 60 * 1000;
const ALT_LANDING_POLL_MS = 200;
const ALT_LANDING_WAIT_MS = 5_000;

const FINISHED: ReadonlySet<BackgroundAgentSessionStatus> = new Set([
  "completed",
  "truncated",
]);
const STOPPED: ReadonlySet<BackgroundAgentSessionStatus> = new Set([
  "errored",
  "aborted",
]);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function imageAttachment(dataUrl: string) {
  const mediaType = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "image/png";
  const extension = mediaType.split("/")[1]?.split("+")[0] || "png";
  return {
    type: "image",
    name: `image.${extension}`,
    contentType: mediaType,
    data: dataUrl,
  };
}

export function useQuietAltText({ currentAlt }: { currentAlt: string }) {
  const [state, setState] = useState<QuietAltTextState>({ phase: "idle" });
  const currentAltRef = useRef(currentAlt);
  useEffect(() => {
    currentAltRef.current = currentAlt;
  }, [currentAlt]);
  const runTokenRef = useRef(0);
  const handleRef = useRef<BackgroundAgentSessionHandle | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runTokenRef.current += 1;
    };
  }, []);

  const settle = useCallback((token: number, next: QuietAltTextState) => {
    if (!mountedRef.current || runTokenRef.current !== token) return;
    handleRef.current = null;
    setState(next);
  }, []);

  const altLanded = useCallback(async (altAtStart: string) => {
    const deadline = Date.now() + ALT_LANDING_WAIT_MS;
    for (;;) {
      if (currentAltRef.current.trim() !== altAtStart.trim()) return true;
      if (Date.now() >= deadline) return false;
      await wait(ALT_LANDING_POLL_MS);
    }
  }, []);

  const follow = useCallback(
    async (
      token: number,
      handle: BackgroundAgentSessionHandle,
      altAtStart: string,
    ) => {
      const isCurrent = () =>
        mountedRef.current && runTokenRef.current === token;
      const streamClosed = handle.completion.then(
        () => true,
        () => true,
      );
      const deadline = Date.now() + STATUS_GIVE_UP_MS;
      let closed = false;
      while (isCurrent()) {
        if (!closed) {
          closed = await Promise.race([
            streamClosed,
            wait(STATUS_POLL_MS).then(() => false),
          ]);
          if (!isCurrent()) return;
        }
        let status: BackgroundAgentSessionStatus | null = null;
        try {
          status = (await handle.status()).status;
        } catch {
          status = null;
        }
        if (!isCurrent()) return;
        if (status && FINISHED.has(status)) {
          const landed = await altLanded(altAtStart);
          settle(
            token,
            landed
              ? { phase: "done", threadId: handle.threadId }
              : {
                  phase: "failed",
                  reason: "error",
                  threadId: handle.threadId,
                },
          );
          return;
        }
        if ((status && STOPPED.has(status)) || Date.now() >= deadline) {
          settle(token, {
            phase: "failed",
            reason: "error",
            threadId: handle.threadId,
          });
          return;
        }
        if (closed) await wait(STATUS_POLL_MS);
      }
    },
    [altLanded, settle],
  );

  const start = useCallback(
    async (request: QuietAltTextRequest) => {
      const token = ++runTokenRef.current;
      if (currentAltRef.current !== request.altAtStart) {
        settle(token, { phase: "kept" });
        return;
      }
      let handle: BackgroundAgentSessionHandle;
      try {
        handle = startBackgroundAgentSession({
          message: request.message,
          instructions: request.instructions,
          scope: { type: QUIET_ALT_TEXT_SCOPE_TYPE, id: request.documentId },
          ...(request.imageDataUrl
            ? { attachments: [imageAttachment(request.imageDataUrl)] }
            : {}),
          usageLabel: "content:image-alt-text",
        });
      } catch {
        settle(token, { phase: "failed", reason: "error", threadId: null });
        return;
      }
      handleRef.current = handle;
      setState({ phase: "running", threadId: handle.threadId });
      try {
        await handle.accepted;
      } catch (error) {
        if (isAgentChatAiSetupRequiredError(error)) {
          settle(token, { phase: "failed", reason: "setup", threadId: null });
          return;
        }
        let started = false;
        try {
          const snapshot = await handle.status();
          started = snapshot.status !== "unavailable";
        } catch {
          started = false;
        }
        if (!started) {
          settle(token, { phase: "failed", reason: "error", threadId: null });
          return;
        }
      }
      await follow(token, handle, request.altAtStart);
    },
    [follow, settle],
  );

  const keepTypedAlt = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    runTokenRef.current += 1;
    handleRef.current = null;
    void handle.cancel("user-typed-alt-text").catch(() => {});
    setState({ phase: "kept" });
  }, []);

  const openChat = useCallback(() => {
    const threadId =
      state.phase === "running" ||
      state.phase === "done" ||
      state.phase === "failed"
        ? state.threadId
        : null;
    if (threadId) {
      requestAgentChatThreadOpen({ threadId });
      return;
    }
    window.dispatchEvent(
      new CustomEvent("agent-panel:open", { detail: { focus: true } }),
    );
  }, [state]);

  const dismiss = useCallback(() => {
    if (handleRef.current) return;
    setState({ phase: "idle" });
  }, []);

  return { state, start, keepTypedAlt, openChat, dismiss };
}
