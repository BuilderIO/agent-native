import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useActionQuery, useSendToAgentChat } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  IconArrowLeft,
  IconExternalLink,
  IconRefresh,
  IconAlertCircle,
  IconBrandGithub,
  IconDatabase,
  IconWorld,
  IconCopy,
  IconCheck,
  IconMessageCircle,
} from "@tabler/icons-react";
import Markdown from "@/components/Markdown";
import { cn } from "@/lib/utils";

function refId(id: string) {
  return `KQ-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function CopyRefId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const ref = refId(id);

  function copy() {
    navigator.clipboard.writeText(ref).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 font-mono text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      aria-label="Copy reference ID"
    >
      {ref}
      {copied ? (
        <IconCheck className="h-3 w-3 text-green-500" />
      ) : (
        <IconCopy className="h-3 w-3" />
      )}
    </button>
  );
}

interface Source {
  type: "github" | "dbt" | "notion" | "other";
  title: string;
  url?: string;
  repo?: string;
  excerpt?: string;
}

function sourceIcon(type: Source["type"]) {
  if (type === "github")
    return <IconBrandGithub className="h-3.5 w-3.5 shrink-0" />;
  if (type === "dbt") return <IconDatabase className="h-3.5 w-3.5 shrink-0" />;
  return <IconWorld className="h-3.5 w-3.5 shrink-0" />;
}

function SourceCard({ source, index }: { source: Source; index: number }) {
  const inner = (
    <div
      className={cn(
        "group flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-sm transition-colors",
        source.url &&
          "hover:border-primary/30 hover:bg-accent/30 cursor-pointer",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground leading-5">
            {source.title}
          </p>
          {source.repo && (
            <p className="text-[11px] text-muted-foreground">{source.repo}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          <span className="text-muted-foreground/60">
            {sourceIcon(source.type)}
          </span>
          {source.url && (
            <IconExternalLink className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
          )}
        </div>
      </div>
      {source.excerpt && (
        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3 pl-7">
          {source.excerpt}
        </p>
      )}
    </div>
  );

  if (source.url) {
    return (
      <a href={source.url} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return inner;
}

const DASHBOARD_RE = /dashboard|workbook|chart|visualization|sigma/i;

function StatusLabel({
  status,
  question,
}: {
  status: string;
  question?: string;
}) {
  if (status === "searching")
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Searching sources…
      </span>
    );
  if (status === "generating") {
    const label =
      question && DASHBOARD_RE.test(question)
        ? "Searching dashboards…"
        : "Looking up in dbt…";
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
        {label}
      </span>
    );
  }
  if (status === "error")
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive">
        <IconAlertCircle className="h-3.5 w-3.5" />
        Error
      </span>
    );
  return null;
}

interface Props {
  id: string;
}

const BACKGROUND_TIMEOUT_MS = 30_000;
const AGENT_TIMEOUT_MS = 90_000;

export default function AnswerPage({ id }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const agentTriggeredRef = useRef(false);
  const sidebarTriggeredRef = useRef(false);
  const generatingStartRef = useRef<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const { send } = useSendToAgentChat();

  function openInChat() {
    const q = session?.question ?? "";
    const ref = session?.id
      ? `KQ-${session.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`
      : "";
    send({
      message: `Based on ${ref} — ${q} — let's dig deeper`,
      submit: false,
    });
    navigate("/");
  }

  const { data: session, isLoading } = useActionQuery(
    "get-session",
    { id },
    { staleTime: 0, enabled: !!id },
  );

  const sessionNotFound = (session as any)?.notFound === true;
  const isDone =
    sessionNotFound ||
    session?.status === "done" ||
    session?.status === "error";

  useEffect(() => {
    if (
      session?.status === "generating" &&
      generatingStartRef.current === null
    ) {
      generatingStartRef.current = Date.now();
    }
    if (isDone) generatingStartRef.current = null;
  }, [session?.status, isDone]);

  useEffect(() => {
    if (isDone) return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["action", "get-session"] });
      const elapsed = generatingStartRef.current
        ? Date.now() - generatingStartRef.current
        : 0;

      if (
        elapsed > BACKGROUND_TIMEOUT_MS &&
        !sidebarTriggeredRef.current &&
        session &&
        !isDone
      ) {
        sidebarTriggeredRef.current = true;
        send({
          message: session.question,
          context: JSON.stringify({
            sessionId: session.id,
            question: session.question,
            sources: session.sources,
            instruction: DASHBOARD_RE.test(session.question)
              ? "This is a dashboard/visualization question — use Sigma MCP (begin_session first, then search). Call store-answer when done. DO NOT create dashboards, analyses, or any other resources — the Knowledge tab is read-only."
              : "Use dbt MCP to look up the model or metric. Call store-answer when done. DO NOT create dashboards, analyses, or any other resources — the Knowledge tab is read-only.",
          }),
          submit: true,
        });
      }
      if (elapsed > AGENT_TIMEOUT_MS) setTimedOut(true);
    }, 3000);
    return () => clearInterval(interval);
  }, [isDone, queryClient, session, send]);

  function triggerAgent(s: NonNullable<typeof session>) {
    agentTriggeredRef.current = true;
    send({
      message: s.question,
      context: JSON.stringify({
        sessionId: s.id,
        question: s.question,
        sources: s.sources,
        instruction: DASHBOARD_RE.test(s.question)
          ? "This is a dashboard/visualization question — use Sigma MCP (begin_session first, then search). Call store-answer when done."
          : "Use dbt MCP to look up the model or metric. Call store-answer when done. DO NOT create dashboards, analyses, or any other resources — the Knowledge tab is read-only.",
      }),
      submit: true,
      background: true,
    });
  }

  function retriggerAgent() {
    if (!session) return;
    agentTriggeredRef.current = false;
    sidebarTriggeredRef.current = false;
    generatingStartRef.current = Date.now();
    setTimedOut(false);
    triggerAgent(session);
  }

  useEffect(() => {
    if (!session || agentTriggeredRef.current) return;
    if (session.status !== "generating") return;
    triggerAgent(session);
  }, [session?.status]);

  const question = session?.question ?? "";
  const sources: Source[] = session?.sources ?? [];

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2 px-4 py-2 max-w-5xl mx-auto">
          <Link to="/knowledge">
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
              <IconArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <span className="text-sm text-muted-foreground truncate flex-1 min-w-0">
            {question}
          </span>
          <div className="shrink-0">
            {!isDone && (
              <StatusLabel
                status={session?.status ?? "searching"}
                question={question}
              />
            )}
            {isDone && session?.status === "done" && (
              <Badge variant="secondary" className="text-xs">
                answered
              </Badge>
            )}
            {isDone && session?.status === "error" && (
              <Badge variant="destructive" className="text-xs">
                error
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-10">
          {/* ── Answer column ── */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-2xl font-semibold leading-snug">
                {question}
              </h1>
              {session?.id && <CopyRefId id={session.id} />}
            </div>

            {/* Answer */}
            <div
              className={cn(
                "prose prose-sm max-w-none dark:prose-invert border-l-2 border-muted pl-4",
                session?.status === "error" && "text-destructive",
              )}
            >
              {sessionNotFound ? (
                <p className="text-muted-foreground">
                  This session is no longer available.{" "}
                  <Link to="/knowledge" className="underline">
                    Ask a new question →
                  </Link>
                </p>
              ) : isLoading || (!session?.answer && !isDone) ? (
                <div className="flex flex-col gap-3 mt-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full mt-2" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              ) : session?.answer ? (
                <Markdown content={session.answer} />
              ) : null}
            </div>

            {/* Use in chat bridge */}
            {isDone && session?.status === "done" && session?.answer && (
              <div className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={openInChat}
                >
                  <IconMessageCircle className="h-3.5 w-3.5" />
                  Use in chat
                  <IconArrowLeft className="h-3 w-3 rotate-180" />
                </Button>
              </div>
            )}

            {/* Error state */}
            {isDone && session?.status === "error" && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <IconAlertCircle className="h-4 w-4 shrink-0" />
                <span>Something went wrong.</span>
                <Link to="/knowledge">
                  <Button variant="ghost" size="sm" className="h-7 ml-1">
                    <IconRefresh className="h-3.5 w-3.5 mr-1" />
                    Ask again
                  </Button>
                </Link>
              </div>
            )}

            {/* Timeout banner */}
            {timedOut && !isDone && (
              <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <IconAlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                <span className="flex-1">
                  The agent is taking longer than expected. Check the chat
                  sidebar or retry.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={retriggerAgent}
                >
                  <IconRefresh className="h-3.5 w-3.5 mr-1" />
                  Retry
                </Button>
              </div>
            )}
          </div>

          {/* ── Sources column ── */}
          {(sources.length > 0 || isLoading) && (
            <div className="lg:w-64 xl:w-72 shrink-0 flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Sources
              </h2>
              {isLoading && sources.length === 0 ? (
                <>
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                </>
              ) : (
                sources.map((s, i) => (
                  <SourceCard
                    key={`${s.url ?? s.title}-${i}`}
                    source={s}
                    index={i}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
