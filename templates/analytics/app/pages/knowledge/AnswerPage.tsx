import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
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
} from "@tabler/icons-react";
import Markdown from "@/components/Markdown";
import { cn } from "@/lib/utils";

interface Source {
  type: "github" | "dbt" | "notion" | "other";
  title: string;
  url?: string;
  repo?: string;
  excerpt?: string;
}

function SourceCard({ source, index }: { source: Source; index: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-muted text-xs font-mono font-medium">
            {index + 1}
          </span>
          <span className="font-mono text-xs truncate text-foreground">
            {source.title}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {source.type !== "github" && (
            <Badge variant="secondary" className="text-xs">
              {source.type}
            </Badge>
          )}
          {source.repo && (
            <span className="text-xs text-muted-foreground truncate max-w-[120px]">
              {source.repo}
            </span>
          )}
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Open source"
            >
              <IconExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
      {source.excerpt && (
        <p className="text-xs text-muted-foreground line-clamp-2 font-mono pl-7">
          {source.excerpt}
        </p>
      )}
    </div>
  );
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
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground animate-pulse">
        <span className="h-2 w-2 rounded-full bg-amber-400" />
        Searching GitHub…
      </span>
    );
  if (status === "generating") {
    const label =
      question && DASHBOARD_RE.test(question)
        ? "Searching Sigma…"
        : "Consulting dbt MCP…";
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground animate-pulse">
        <span className="h-2 w-2 rounded-full bg-blue-400" />
        {label}
      </span>
    );
  }
  if (status === "error")
    return (
      <span className="flex items-center gap-1.5 text-sm text-destructive">
        <IconAlertCircle className="h-4 w-4" />
        Something went wrong
      </span>
    );
  return null;
}

interface Props {
  id: string;
}

const AGENT_TIMEOUT_MS = 60_000;

export default function AnswerPage({ id }: Props) {
  const queryClient = useQueryClient();
  const agentTriggeredRef = useRef(false);
  const generatingStartRef = useRef<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const { send } = useSendToAgentChat();

  const { data: session, isLoading } = useActionQuery(
    "get-session",
    { id },
    { staleTime: 0, enabled: !!id },
  );

  const isDone = session?.status === "done" || session?.status === "error";

  // Track when we entered generating state
  useEffect(() => {
    if (session?.status === "generating" && generatingStartRef.current === null) {
      generatingStartRef.current = Date.now();
    }
    if (isDone) generatingStartRef.current = null;
  }, [session?.status, isDone]);

  // Poll every 3s until agent writes the answer; timeout after 90s
  useEffect(() => {
    if (isDone) return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["action", "get-session"] });
      if (
        generatingStartRef.current !== null &&
        Date.now() - generatingStartRef.current > AGENT_TIMEOUT_MS
      ) {
        setTimedOut(true);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isDone, queryClient]);

  function retriggerAgent() {
    if (!session) return;
    agentTriggeredRef.current = false;
    generatingStartRef.current = Date.now();
    setTimedOut(false);
    triggerAgent(session);
  }

  function triggerAgent(s: NonNullable<typeof session>) {
    agentTriggeredRef.current = true;
    send({
      message: s.question,
      context: JSON.stringify({
        sessionId: s.id,
        question: s.question,
        sources: s.sources,
        instruction: /dashboard|workbook|chart|visualization|sigma/i.test(s.question)
          ? "This is a dashboard/visualization question — use Sigma MCP (begin_session first, then search). Call store-answer when done."
          : "Use dbt MCP to look up the model or metric. Call store-answer when done.",
      }),
      submit: true,
      background: true,
    });
  }

  // Trigger agent once when session enters "generating" state
  useEffect(() => {
    if (!session || agentTriggeredRef.current) return;
    if (session.status !== "generating") return;

    triggerAgent(session);
  }, [session?.status, send]);

  const question = session?.question ?? "";
  const sources: Source[] = session?.sources ?? [];

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 backdrop-blur px-6 py-3">
        <Link to="/knowledge">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <IconArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <span className="text-sm text-muted-foreground truncate flex-1">
          {question}
        </span>
        {!isDone && <StatusLabel status={session?.status ?? "searching"} question={question} />}
        {isDone && session?.status === "done" && (
          <Badge variant="secondary" className="shrink-0">
            answered
          </Badge>
        )}
        {isDone && session?.status === "error" && (
          <Badge variant="destructive" className="shrink-0">
            error
          </Badge>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-8 px-6 py-8 max-w-5xl w-full mx-auto">
        {/* Answer column */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          <div>
            <h1 className="text-xl font-semibold">{question}</h1>
          </div>

          {/* Answer area */}
          <div
            className={cn(
              "rounded-xl border bg-card p-6 prose prose-sm max-w-none dark:prose-invert",
              session?.status === "error" && "border-destructive/50",
            )}
          >
            {isLoading || !session ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : session?.answer ? (
              <Markdown content={session.answer} />
            ) : (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            )}
          </div>

          {isDone && session?.status === "error" && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <IconAlertCircle className="h-4 w-4" />
              The agent encountered an error. Try refreshing or asking again.
              <Link to="/knowledge">
                <Button variant="ghost" size="sm" className="ml-2 h-7">
                  <IconRefresh className="h-3.5 w-3.5 mr-1" />
                  Ask again
                </Button>
              </Link>
            </div>
          )}

          {timedOut && !isDone && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground rounded-lg border border-dashed p-4">
              <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
              <span>The agent is taking longer than expected.</span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7"
                onClick={retriggerAgent}
              >
                <IconRefresh className="h-3.5 w-3.5 mr-1" />
                Retry
              </Button>
            </div>
          )}
        </div>

        {/* Sources column */}
        {sources.length > 0 && (
          <div className="lg:w-72 shrink-0 flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sources
            </h2>
            {sources.map((s, i) => (
              <SourceCard
                key={`${s.url ?? s.title}-${i}`}
                source={s}
                index={i}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
