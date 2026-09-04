import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { markAgentChatHomeHandoff } from "@agent-native/core/client/agentkit-chat/rail";
import { APP_TITLE } from "@/lib/app-config";
import { getChatHomeThreadId } from "@/lib/chat-home-thread";

const SEO_TITLE = `${APP_TITLE} - Open Source AI app starter with actions`;
const SEO_DESCRIPTION =
  "Open Source starter for agent-native apps with durable chat, shared actions, UI state, tools, and a backend your agent can extend.";

export function meta() {
  return [
    { title: SEO_TITLE },
    {
      name: "description",
      content: SEO_DESCRIPTION,
    },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function ChatRoute() {
  const [threadId] = useState(getChatHomeThreadId);
  const navigate = useNavigate();

  useEffect(() => {
    markAgentChatHomeHandoff("chat");
    navigate(`/chat/${encodeURIComponent(threadId)}`, { replace: true });
  }, [navigate, threadId]);

  return null;
}
