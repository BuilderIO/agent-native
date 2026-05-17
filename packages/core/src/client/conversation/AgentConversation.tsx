import React from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconCheck,
  IconChevronDown,
  IconCircleX,
  IconClock,
  IconExternalLink,
  IconLoader2,
  IconTool,
} from "@tabler/icons-react";
import { cn } from "../utils.js";
import { useNearBottomAutoscroll } from "./use-near-bottom-autoscroll.js";
import type {
  AgentConversationArtifact,
  AgentConversationMessage,
  AgentConversationMessagePart,
  AgentConversationNotice,
  AgentConversationToolCall,
} from "./types.js";

export interface AgentConversationProps {
  messages: AgentConversationMessage[];
  loading?: boolean;
  error?: string | null;
  streaming?: boolean;
  className?: string;
  timelineClassName?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  composer?: React.ReactNode;
}

export function AgentConversation({
  messages,
  loading = false,
  error,
  streaming = false,
  className,
  timelineClassName,
  emptyTitle = "No messages yet",
  emptyDescription,
  composer,
}: AgentConversationProps) {
  const followKey = `${messages.length}:${
    messages[messages.length - 1]?.text?.length ?? 0
  }`;
  const { scrollRef, showScrollToBottom, scrollToBottom } =
    useNearBottomAutoscroll<HTMLDivElement>({
      followKey,
      streaming,
    });

  return (
    <section className={cn("agent-conversation", className)}>
      {error && (
        <div className="agent-conversation__error" role="alert">
          <IconAlertTriangle size={15} strokeWidth={1.8} />
          <span>{error}</span>
        </div>
      )}
      <div
        ref={scrollRef}
        className={cn("agent-conversation__timeline", timelineClassName)}
      >
        {loading && messages.length === 0 ? (
          <ConversationEmpty
            icon={<IconLoader2 size={17} className="agent-conversation-spin" />}
            title="Loading session..."
          />
        ) : messages.length === 0 ? (
          <ConversationEmpty
            icon={<IconClock size={18} />}
            title={emptyTitle}
            description={emptyDescription}
          />
        ) : (
          messages.map((message) => (
            <AgentConversationMessageView key={message.id} message={message} />
          ))
        )}
      </div>
      {showScrollToBottom && (
        <button
          type="button"
          className="agent-conversation__scroll-bottom"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          <IconArrowDown size={15} strokeWidth={1.9} />
        </button>
      )}
      {composer}
    </section>
  );
}

function ConversationEmpty({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="agent-conversation__empty">
      {icon}
      <p>{title}</p>
      {description && <span>{description}</span>}
    </div>
  );
}

export function AgentConversationMessageView({
  message,
}: {
  message: AgentConversationMessage;
}) {
  const parts = message.parts ?? legacyPartsForMessage(message);

  return (
    <article
      className={cn(
        "agent-conversation-message",
        `agent-conversation-message--${message.role}`,
        message.pending && "agent-conversation-message--pending",
      )}
    >
      <div className="agent-conversation-message__body">
        {parts.map((part) => (
          <ConversationMessagePartView key={part.id} part={part} />
        ))}
      </div>
    </article>
  );
}

function legacyPartsForMessage(
  message: AgentConversationMessage,
): AgentConversationMessagePart[] {
  return [
    ...(message.text
      ? [
          {
            id: `${message.id}-text`,
            type: "text" as const,
            text: message.text,
          },
        ]
      : []),
    ...(message.tools ?? []).map((tool) => ({
      id: `${message.id}-tool-${tool.id}`,
      type: "tool" as const,
      tool,
    })),
    ...(message.notices ?? []).map((notice) => ({
      id: `${message.id}-notice-${notice.id}`,
      type: "notice" as const,
      notice,
    })),
    ...(message.artifacts ?? []).map((artifact) => ({
      id: `${message.id}-artifact-${artifact.id}`,
      type: "artifact" as const,
      artifact,
    })),
  ];
}

function ConversationMessagePartView({
  part,
}: {
  part: AgentConversationMessagePart;
}) {
  return (
    <div
      className={cn(
        "agent-conversation-message__part",
        `agent-conversation-message__part--${part.type}`,
      )}
    >
      {part.type === "text" ? (
        <ConversationMarkdown text={part.text} />
      ) : part.type === "tool" ? (
        <ConversationToolCall tool={part.tool} />
      ) : part.type === "notice" ? (
        <ConversationNotice notice={part.notice} />
      ) : (
        <ConversationArtifact artifact={part.artifact} />
      )}
    </div>
  );
}

function ConversationMarkdown({ text }: { text: string }) {
  return (
    <div className="agent-conversation-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => {
          if (url.startsWith("file://")) return url;
          return defaultUrlTransform(url);
        }}
        components={{
          a({ children, href }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => openMarkdownLink(event, href)}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function openMarkdownLink(
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string | undefined,
) {
  if (!href) return;

  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return;
  }

  if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) return;
  event.preventDefault();
  window.open(url.href, "_blank", "noopener,noreferrer");
}

function ConversationToolCall({ tool }: { tool: AgentConversationToolCall }) {
  const hasDetails = Boolean(tool.input || tool.result);
  const icon =
    tool.state === "running" || tool.state === "activity" ? (
      <IconLoader2 size={14} className="agent-conversation-spin" />
    ) : tool.state === "errored" ? (
      <IconCircleX size={14} />
    ) : (
      <IconCheck size={14} />
    );

  const content = (
    <>
      <span className="agent-conversation-tool__icon">{icon}</span>
      <span className="agent-conversation-tool__name">{tool.name}</span>
      {tool.summary && (
        <span className="agent-conversation-tool__summary">{tool.summary}</span>
      )}
    </>
  );

  if (!hasDetails) {
    return <div className="agent-conversation-tool">{content}</div>;
  }

  return (
    <details className="agent-conversation-tool">
      <summary>
        {content}
        <IconChevronDown
          size={13}
          className="agent-conversation-tool__chevron"
        />
      </summary>
      <div className="agent-conversation-tool__details">
        {tool.input && (
          <pre>
            <strong>input</strong>
            {tool.input}
          </pre>
        )}
        {tool.result && (
          <pre>
            <strong>result</strong>
            {tool.result}
          </pre>
        )}
      </div>
    </details>
  );
}

function ConversationNotice({ notice }: { notice: AgentConversationNotice }) {
  return (
    <div
      className={cn(
        "agent-conversation-notice",
        `agent-conversation-notice--${notice.tone}`,
      )}
    >
      <IconAlertTriangle size={15} />
      <div>
        {notice.title && <strong>{notice.title}</strong>}
        <span>{notice.text}</span>
      </div>
      {notice.action}
    </div>
  );
}

function ConversationArtifact({
  artifact,
}: {
  artifact: AgentConversationArtifact;
}) {
  return (
    <div className="agent-conversation-artifact">
      <IconTool size={14} />
      {artifact.path ? (
        <code>{artifact.path}</code>
      ) : (
        <span>{artifact.label}</span>
      )}
      {artifact.url && (
        <a href={artifact.url} target="_blank" rel="noreferrer">
          <IconExternalLink size={13} />
          Open
        </a>
      )}
    </div>
  );
}
