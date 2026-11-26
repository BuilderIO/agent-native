import type { RefObject, Dispatch, SetStateAction } from "react";

export function handleHostChatState({
  next,
  hostChatGeneratingRef,
  stagedSourceHandoffRef,
  stagedHandoffStartedRef,
  clearStartTimer,
  setApplyingViaHost,
  reloadRunningAppPreviewFrames,
}: {
  next: string | undefined;
  hostChatGeneratingRef: RefObject<boolean>;
  stagedSourceHandoffRef: RefObject<"idle" | "awaiting-start" | "running">;
  stagedHandoffStartedRef: RefObject<(() => void) | undefined>;
  clearStartTimer: () => void;
  setApplyingViaHost: Dispatch<SetStateAction<boolean>>;
  reloadRunningAppPreviewFrames: () => void;
}) {
  if (
    next === "generating" &&
    stagedSourceHandoffRef.current === "awaiting-start"
  ) {
    stagedSourceHandoffRef.current = "running";
    stagedHandoffStartedRef.current?.();
    stagedHandoffStartedRef.current = undefined;
    clearStartTimer();
  }
  if (hostChatGeneratingRef.current && next !== "generating") {
    reloadRunningAppPreviewFrames();
    if (stagedSourceHandoffRef.current === "running") {
      stagedSourceHandoffRef.current = "idle";
      stagedHandoffStartedRef.current = undefined;
      setApplyingViaHost(false);
    }
  }
  hostChatGeneratingRef.current = next === "generating";
}
