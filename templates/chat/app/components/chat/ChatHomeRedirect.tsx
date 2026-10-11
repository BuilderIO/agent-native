import { appPath } from "@agent-native/core/client/api-path";
import { markAgentChatHomeHandoff } from "@agent-native/toolkit/app/chat/agentkit-chat/rail";
import { useEffect, useRef, useState } from "react";

import { getChatHomeThreadId } from "@/lib/chat-home-thread";
import { chatThreadPath } from "@/lib/chat-paths";

export default function ChatHomeRedirect() {
  const [threadId] = useState(getChatHomeThreadId);
  const handoffStartedRef = useRef(false);

  useEffect(() => {
    if (handoffStartedRef.current) return;
    handoffStartedRef.current = true;
    markAgentChatHomeHandoff("chat");
    try {
      window.location.replace(appPath(chatThreadPath(threadId)));
    } catch (error) {
      handoffStartedRef.current = false;
      throw error;
    }
  }, [threadId]);

  return null;
}
