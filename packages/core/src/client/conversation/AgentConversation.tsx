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
import React from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { HighlightedCodeBlock as SharedHighlightedCodeBlock } from "../HighlightedCodeBlock.js";
import { McpAppRenderer } from "../mcp-apps/McpAppRenderer.js";
import { humanizeToolName } from "../tool-display.js";
import { cn } from "../utils.js";
import type {
  AgentConversationAttachment,
  AgentConversationArtifact,
  AgentConversationMessage,
  AgentConversationMessagePart,
  AgentConversationNotice,
  AgentConversationToolCall,
} from "./types.js";
import { useNearBottomAutoscroll } from "./use-near-bottom-autoscroll.js";

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
      {message.attachments && message.attachments.length > 0 && (
        <div className="agent-conversation-message__attachments">
          {message.attachments.map((attachment, i) => (
            <ConversationAttachmentChip
              key={`${attachment.name}-${i}`}
              attachment={attachment}
            />
          ))}
        </div>
      )}
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

// ─── Shiki syntax highlighter (lazy-loaded) ──────────────────────────────────
type ShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: {
      lang: string;
      themes: { light: string; dark: string };
      defaultColor?: false | "light" | "dark";
    },
  ) => string | Promise<string>;
  getLoadedLanguages: () => string[];
};

let _highlighterLoader: Promise<ShikiHighlighter> | null = null;
function loadConversationHighlighter(): Promise<ShikiHighlighter> {
  if (!_highlighterLoader) {
    _highlighterLoader = (async () => {
      // Use the JavaScript regex engine instead of Oniguruma WASM (~608 KB saved).
      // forgiving:true degrades unsupported patterns gracefully instead of throwing.
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/javascript"),
        ]);
      return createHighlighterCore({
        themes: [
          import("shiki/themes/github-light-default.mjs"),
          import("shiki/themes/github-dark-default.mjs"),
        ],
        langs: [
          import("shiki/langs/javascript.mjs"),
          import("shiki/langs/typescript.mjs"),
          import("shiki/langs/jsx.mjs"),
          import("shiki/langs/tsx.mjs"),
          import("shiki/langs/json.mjs"),
          import("shiki/langs/css.mjs"),
          import("shiki/langs/html.mjs"),
          import("shiki/langs/markdown.mjs"),
          import("shiki/langs/bash.mjs"),
          import("shiki/langs/shellscript.mjs"),
          import("shiki/langs/python.mjs"),
          import("shiki/langs/yaml.mjs"),
          import("shiki/langs/sql.mjs"),
        ],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      }) as unknown as Promise<ShikiHighlighter>;
    })().catch((err) => {
      _highlighterLoader = null;
      throw err;
    });
  }
  return _highlighterLoader;
}

function ConversationMarkdown({ text }: { text: string }) {
  return (
    <div className="agent-conversation-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={defaultUrlTransform}
        components={{
          a({ children, href }) {
            if (!href) {
              return <span>{children}</span>;
            }
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
          pre(props: React.HTMLAttributes<HTMLPreElement>) {
            const { children, ...rest } = props;
            if (React.isValidElement(children)) {
              const childProps = children.props as {
                className?: string;
                children?: React.ReactNode;
              };
              const langMatch = (childProps.className ?? "").match(
                /\blanguage-([\w+-]+)\b/,
              );
              if (langMatch) {
                const code = extractCodeText(childProps.children).replace(
                  /\n$/,
                  "",
                );
                return (
                  <SharedHighlightedCodeBlock
                    code={code}
                    lang={langMatch[1]}
                    containerClass="agent-conversation-shiki"
                    loadHighlighter={loadConversationHighlighter}
                  />
                );
              }
            }
            return <pre {...rest}>{children}</pre>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function extractCodeText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractCodeText).join("");
  if (React.isValidElement(node)) {
    return extractCodeText(
      (node.props as { children?: React.ReactNode }).children,
    );
  }
  return "";
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
    event.preventDefault();
    return;
  }

  if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  window.open(url.href, "_blank", "noopener,noreferrer");
}

function ConversationToolCall({ tool }: { tool: AgentConversationToolCall }) {
  const hasDetails = Boolean(tool.input || tool.result || tool.mcpApp);
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
      <span className="agent-conversation-tool__name">
        {humanizeToolName(tool.name)}
      </span>
      {tool.summary && (
        <span className="agent-conversation-tool__summary">{tool.summary}</span>
      )}
    </>
  );

  if (!hasDetails) {
    return <div className="agent-conversation-tool">{content}</div>;
  }

  return (
    <details
      className="agent-conversation-tool"
      open={tool.mcpApp ? true : undefined}
    >
      <summary>
        {content}
        <IconChevronDown
          size={13}
          className="agent-conversation-tool__chevron"
        />
      </summary>
      <div className="agent-conversation-tool__details">
        {tool.mcpApp && <McpAppRenderer app={tool.mcpApp} />}
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

function ConversationAttachmentChip({
  attachment,
}: {
  attachment: AgentConversationAttachment;
}) {
  if (attachment.dataUrl) {
    return (
      <div className="agent-conversation-attachment agent-conversation-attachment--image">
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          className="agent-conversation-attachment__image"
        />
        <span className="agent-conversation-attachment__name">
          {attachment.name}
        </span>
      </div>
    );
  }
  return (
    <div className="agent-conversation-attachment agent-conversation-attachment--file">
      <span className="agent-conversation-attachment__name">
        {attachment.name}
      </span>
      {attachment.size !== undefined && (
        <span className="agent-conversation-attachment__size">
          {formatBytes(attachment.size)}
        </span>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
