import { useState, useEffect, useCallback } from "react";
import { sendToFusionChat, type FusionChatMessage } from "./fusion-chat.js";

/**
 * Hook that wraps sendToFusionChat with a loading state.
 *
 * Returns [isGenerating, send] where:
 * - isGenerating: true after send() is called, false when the
 *   builder.fusion.chatRunning event fires with detail.isRunning === false
 * - send: wrapper around sendToFusionChat that sets isGenerating to true
 */
export function useFusionChatGenerating(): [
  boolean,
  (opts: FusionChatMessage) => void,
] {
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.isRunning === false) {
        setIsGenerating(false);
      }
    };
    window.addEventListener("builder.fusion.chatRunning", handler);
    return () =>
      window.removeEventListener("builder.fusion.chatRunning", handler);
  }, []);

  const send = useCallback((opts: FusionChatMessage) => {
    setIsGenerating(true);
    sendToFusionChat(opts);
  }, []);

  return [isGenerating, send];
}
