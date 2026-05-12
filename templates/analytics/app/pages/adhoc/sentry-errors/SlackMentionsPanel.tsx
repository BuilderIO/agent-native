import { useState } from "react";
import { useActionMutation } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IconBrandSlack,
  IconSearch,
  IconMessage,
  IconAlertTriangle,
  IconExternalLink,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import type { SentryIssue } from "./index";

// ---- Types ------------------------------------------------------------------

interface SlackMessage {
  type: string;
  user?: string;
  username?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  channel?: { id: string; name: string } | string;
  permalink?: string;
}

interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  profile: { display_name: string };
}

interface SlackSearchResult {
  messages?: SlackMessage[];
  users?: Record<string, SlackUser>;
  total?: number;
  error?: string;
}

// ---- Helpers ----------------------------------------------------------------

function tsToDate(ts: string): string {
  const ms = parseFloat(ts) * 1000;
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function resolveUsername(
  msg: SlackMessage,
  users: Record<string, SlackUser>,
): string {
  if (msg.user && users[msg.user]) {
    const u = users[msg.user];
    return u.profile.display_name || u.real_name || u.name;
  }
  return msg.username ?? "Unknown";
}

function stripSlackFormatting(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>/g, "@user")
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function buildSearchQuery(issue: SentryIssue): string {
  const parts: string[] = [];
  // Issue short ID (e.g. "AIR-LAYOUT-1176") is the most specific search term
  if (issue.shortId) parts.push(issue.shortId);
  // Permalink — matches messages where someone pasted the Sentry issue URL
  if (issue.permalink) parts.push(issue.permalink);
  // Error type is meaningful (e.g. "McpError", "TypeError")
  if (issue.metadata.type) parts.push(issue.metadata.type);
  // Truncated error value gives context
  if (issue.metadata.value) {
    const trimmed = issue.metadata.value.slice(0, 50).trim();
    if (trimmed && !parts.some((p) => trimmed.includes(p))) {
      parts.push(trimmed);
    }
  }
  if (parts.length === 0) parts.push(issue.title.slice(0, 80));
  return parts.join(" ").replace(/['"]/g, "").trim();
}

// ---- Main Component ---------------------------------------------------------

interface SlackMentionsPanelProps {
  issue: SentryIssue;
}

export function SlackMentionsPanel({ issue }: SlackMentionsPanelProps) {
  const defaultQuery = buildSearchQuery(issue);
  const [query, setQuery] = useState(defaultQuery);
  const [editingQuery, setEditingQuery] = useState(false);
  const [result, setResult] = useState<SlackSearchResult | null>(null);
  const [searched, setSearched] = useState(false);

  const mutation = useActionMutation("slack-messages");

  const messages = result?.messages ?? [];
  const users: Record<string, SlackUser> = result?.users ?? {};
  const dataError =
    result?.error ??
    (mutation.error ? (mutation.error as Error).message : null);

  function handleSearch() {
    const q = query.trim();
    if (!q) return;
    setEditingQuery(false);
    setSearched(true);
    mutation.mutate(
      { mode: "search", query: q },
      { onSuccess: (data) => setResult(data as SlackSearchResult) },
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
    if (e.key === "Escape") setEditingQuery(false);
  }

  return (
    <div className="pt-3 border-t border-border/50 space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <IconBrandSlack className="h-3.5 w-3.5 shrink-0" />
          Slack mentions
          {searched && !mutation.isPending && !dataError && (
            <span className="font-normal">
              ({messages.length} result{messages.length !== 1 ? "s" : ""})
            </span>
          )}
        </div>
        {searched && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 shrink-0"
            onClick={handleSearch}
            disabled={mutation.isPending}
          >
            <IconRefresh
              className={`h-3.5 w-3.5 ${mutation.isPending ? "animate-spin" : ""}`}
            />
          </Button>
        )}
      </div>

      {/* Search bar */}
      {editingQuery ? (
        <div className="flex gap-1.5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 text-xs font-mono"
            autoFocus
          />
          <Button
            size="sm"
            className="h-8 px-3 text-xs shrink-0"
            onClick={handleSearch}
            disabled={mutation.isPending}
          >
            Search
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 shrink-0"
            onClick={() => setEditingQuery(false)}
          >
            <IconX className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="w-full flex items-center gap-2 h-8 px-3 rounded-md border border-border/60 hover:border-border hover:bg-muted/40 transition-colors text-left group"
          onClick={() => {
            if (!searched) {
              handleSearch();
            } else {
              setEditingQuery(true);
            }
          }}
        >
          <IconSearch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate flex-1">
            {query}
          </span>
          {searched && (
            <span className="text-[10px] text-muted-foreground/60 shrink-0 group-hover:text-muted-foreground">
              edit
            </span>
          )}
        </button>
      )}

      {/* Results */}
      {mutation.isPending ? (
        <div className="space-y-2.5 pt-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="h-6 w-6 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : dataError ? (
        <div className="flex items-start gap-2 text-xs text-muted-foreground py-1">
          <IconAlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-yellow-500" />
          <span>{dataError}</span>
        </div>
      ) : searched && messages.length === 0 ? (
        <div className="space-y-2 py-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <IconMessage className="h-4 w-4 shrink-0" />
            <span>No messages found in accessible channels</span>
          </div>
          <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2.5 space-y-1.5">
            <p className="text-[11px] font-medium text-foreground/80">
              Searching private channels?
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              The bot can only scan public channels it&apos;s been added to. To
              search private channels, add a Slack{" "}
              <strong>User OAuth Token</strong> (xoxp-) in{" "}
              <a
                href="/analytics/data-sources"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Data Sources → Slack
              </a>
              .
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              To get one: Slack app → <strong>OAuth &amp; Permissions</strong> →{" "}
              <strong>User Token Scopes</strong> → add{" "}
              <code className="font-mono bg-muted px-1 rounded">
                search:read
              </code>{" "}
              → Reinstall app → copy the <strong>User OAuth Token</strong>.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {messages.map((msg) => {
            const name = resolveUsername(msg, users);
            const text = stripSlackFormatting(msg.text);
            const channelName =
              typeof msg.channel === "string" ? msg.channel : msg.channel?.name;
            const Row = msg.permalink ? "a" : "div";
            const rowProps = msg.permalink
              ? {
                  href: msg.permalink,
                  target: "_blank" as const,
                  rel: "noopener noreferrer",
                }
              : {};
            return (
              <Row
                key={msg.ts}
                {...rowProps}
                className="flex gap-2 group px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors cursor-pointer -mx-2"
              >
                <div className="h-6 w-6 rounded-full bg-muted/60 shrink-0 flex items-center justify-center text-[10px] font-bold text-muted-foreground uppercase mt-0.5">
                  {name[0] ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold">{name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {tsToDate(msg.ts)}
                    </span>
                    {channelName && (
                      <span className="text-[10px] text-muted-foreground">
                        #{channelName}
                      </span>
                    )}
                    {msg.reply_count ? (
                      <span className="text-[10px] text-muted-foreground">
                        {msg.reply_count} repl
                        {msg.reply_count !== 1 ? "ies" : "y"}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-3 break-words">
                    {text}
                  </p>
                </div>
                {msg.permalink && (
                  <IconExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                )}
              </Row>
            );
          })}
        </div>
      )}
    </div>
  );
}
