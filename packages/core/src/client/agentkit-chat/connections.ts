import { useEffect, useRef } from "react";

import {
  addMcpConnectionCompleteListener,
  consumeMcpConnectionResume,
} from "../resources/mcp-connection-resume.js";
import {
  McpAgentKitConnectionRequestCard,
  type McpAgentKitConnectionResumeProps,
} from "../resources/McpAgentKitConnectionRequest.js";

export { McpAgentKitConnectionRequestCard };

/** Consumes OAuth resumes once and routes them to the matching chat submit API. */
export function McpAgentKitConnectionResume({
  onResume,
  onMessageResume,
}: McpAgentKitConnectionResumeProps) {
  const onResumeRef = useRef(onResume);
  const onMessageResumeRef = useRef(onMessageResume);
  onResumeRef.current = onResume;
  onMessageResumeRef.current = onMessageResume;

  // Chat callbacks change with render state; one listener must own each stored resume.
  useEffect(() => {
    const resumePending = () => {
      const request = consumeMcpConnectionResume();
      if (!request) return;
      const operation = request.agentKit
        ? onResumeRef.current(request.agentKit, request)
        : onMessageResumeRef.current?.(request);
      void Promise.resolve(operation).catch(() => {});
    };

    resumePending();
    return addMcpConnectionCompleteListener(resumePending);
  }, []);
  return null;
}
