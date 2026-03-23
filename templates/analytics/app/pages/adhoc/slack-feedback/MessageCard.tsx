import { MessageSquare, ThumbsUp } from "lucide-react";
import type { SlackMessage, SlackUser } from "./hooks";

interface MessageCardProps {
  message: SlackMessage;
  user?: SlackUser;
}

function formatTimestamp(ts: string): string {
  const date = new Date(parseFloat(ts) * 1000);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncateUrl(url: string, maxLen = 50): string {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const base = u.hostname;
    if (url.length <= maxLen) return url;
    const remaining = maxLen - base.length - 5; // 5 for "..." + "//"
    if (remaining > 10) {
      return `${base}${path.slice(0, remaining)}...`;
    }
    return `${base}/...`;
  } catch {
    if (url.length <= maxLen) return url;
    return url.slice(0, maxLen) + "...";
  }
}

function slackMrkdwnToHtml(text: string): string {
  // Extract code blocks first so they don't get processed
  const codeBlocks: string[] = [];
  let html = text.replace(/```([\s\S]*?)```/g, (_m, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(code);
    return `%%CODEBLOCK_${idx}%%`;
  });

  // Decode HTML entities
  html = html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // Slack special links (must be done before bare URL matching)
  // Also handle mailto links from blocks
  html = html
    .replace(
      /<@(\w+)>/g,
      '<span class="text-blue-400 font-medium">@user</span>',
    )
    .replace(
      /<#\w+\|([^>]+)>/g,
      '<span class="text-blue-400 font-medium">#$1</span>',
    )
    .replace(
      /<(https?:\/\/[^|>]+)\|([^>]+)>/g,
      (_m, url, label) =>
        `<a href="${url}" target="_blank" rel="noopener" class="text-blue-400 underline hover:text-blue-300">${label}</a>`,
    )
    .replace(
      /<(https?:\/\/[^>]+)>/g,
      (_m, url) =>
        `<a href="${url}" target="_blank" rel="noopener" class="text-blue-400 underline hover:text-blue-300">${truncateUrl(url)}</a>`,
    )
    .replace(
      /<mailto:([^|>]+)\|([^>]+)>/g,
      (_m, email, label) =>
        `<a href="mailto:${email}" class="text-blue-400 underline hover:text-blue-300">${label}</a>`,
    )
    .replace(/<mailto:([^>]+)>/g, "$1");

  // Inline code
  html = html.replace(
    /`([^`\n]+)`/g,
    '<code class="bg-muted/50 rounded px-1.5 py-0.5 text-xs font-mono">$1</code>',
  );

  // Bold - don't span across newlines
  html = html.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");

  // Italic - don't span across newlines
  html = html.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<em>$1</em>");

  // Strikethrough
  html = html.replace(/~([^~\n]+)~/g, "<del>$1</del>");

  // Blockquotes (> at start of line)
  html = html.replace(
    /^>\s?(.*)$/gm,
    '<div class="border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground italic my-1">$1</div>',
  );

  // Bare URLs not already in <a> tags or inside HTML attributes
  html = html.replace(
    /(?<!="|'>|">)(https?:\/\/[^\s<>"]+)/g,
    (match, _offset, fullStr) => {
      // Skip if inside an HTML tag (between < and >)
      const before = fullStr.slice(0, fullStr.indexOf(match));
      const lastOpen = before.lastIndexOf("<");
      const lastClose = before.lastIndexOf(">");
      if (lastOpen > lastClose) return match; // inside a tag
      return `<a href="${match}" target="_blank" rel="noopener" class="text-blue-400 underline hover:text-blue-300">${truncateUrl(match)}</a>`;
    },
  );

  // Convert newlines to <br>
  html = html.replace(/\n/g, "<br>");

  // Restore code blocks
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_m, idx) => {
    const code = codeBlocks[parseInt(idx)];
    return `<pre class="bg-muted/50 rounded-md p-3 my-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap">${code}</pre>`;
  });

  return html;
}

export function MessageCard({ message, user }: MessageCardProps) {
  const displayName =
    user?.profile?.display_name || user?.real_name || user?.name || "Unknown";
  const avatar = user?.profile?.image_48;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2 hover:border-border/80 transition-colors">
      {/* Header: avatar + name + timestamp + channel */}
      <div className="flex items-center gap-3">
        {avatar ? (
          <img
            src={avatar}
            alt={displayName}
            className="h-8 w-8 rounded-full flex-shrink-0"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">
            {displayName}
          </span>
          <span className="text-xs text-muted-foreground ml-2">
            {formatTimestamp(message.ts)}
          </span>
        </div>
        {message.channel_name && (
          <span className="text-[11px] text-muted-foreground flex-shrink-0">
            #{message.channel_name}
          </span>
        )}
      </div>

      {/* Message body */}
      <div
        className="text-sm text-foreground/90 break-words leading-relaxed [&_a]:break-all [&_pre]:whitespace-pre-wrap"
        dangerouslySetInnerHTML={{ __html: slackMrkdwnToHtml(message.text) }}
      />

      {/* Footer: reactions + thread count */}
      <div className="flex items-center gap-3 flex-wrap">
        {message.reply_count != null && message.reply_count > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5" />
            {message.reply_count}{" "}
            {message.reply_count === 1 ? "reply" : "replies"}
          </span>
        )}
        {message.reactions?.map((r) => (
          <span
            key={r.name}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            <ThumbsUp className="h-3 w-3" />:{r.name}: {r.count}
          </span>
        ))}
      </div>
    </div>
  );
}
