import { useRef, useState } from "react";
import { useNavigate, Link } from "react-router";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  IconSearch,
  IconClock,
  IconBook2,
  IconArrowRight,
  IconLoader2,
  IconTable,
  IconChartBar,
  IconLayoutDashboard,
  IconTrash,
  IconDatabaseSearch,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

function refId(id: string) {
  return `KQ-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const CATEGORIES: {
  label: string;
  icon: React.ReactNode;
  questions: string[];
}[] = [
  {
    label: "Models & Fields",
    icon: <IconTable className="h-3.5 w-3.5" />,
    questions: [
      "What fields does dim_contracts have?",
      "What does fct_subscriptions contain?",
      "What tables track churned revenue?",
    ],
  },
  {
    label: "Metrics",
    icon: <IconChartBar className="h-3.5 w-3.5" />,
    questions: [
      "How is ARR calculated in our dbt models?",
      "How is churned MRR defined?",
      "Where is expansion revenue tracked?",
    ],
  },
  {
    label: "Dashboards",
    icon: <IconLayoutDashboard className="h-3.5 w-3.5" />,
    questions: [
      "Is there a dashboard for case study opt-ins?",
      "What does the Revenue Dashboard show?",
      "Which dashboards track pipeline health?",
    ],
  },
];

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done") return "secondary";
  if (status === "error") return "destructive";
  return "outline";
}

function statusLabel(status: string) {
  if (status === "done") return "answered";
  if (status === "error") return "error";
  if (status === "generating") return "thinking…";
  return "pending";
}

export default function KnowledgeHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: sessionsData, isLoading: sessionsLoading } = useActionQuery(
    "list-sessions",
    {},
    { staleTime: 5_000 },
  );

  const { mutateAsync: askQuestion, isPending } =
    useActionMutation("ask-question");

  const { mutateAsync: deleteSession } = useActionMutation("delete-session");

  async function handleSubmit(q: string) {
    const trimmed = q.trim();
    if (!trimmed || isPending) return;
    try {
      const result = await askQuestion({ question: trimmed });
      queryClient.invalidateQueries({ queryKey: ["action"] });
      navigate(`/knowledge/answer/${result.sessionId}`);
    } catch (err) {
      console.error("Failed to create knowledge session", err);
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setDeletingId(id);
    try {
      await deleteSession({ id });
      queryClient.invalidateQueries({ queryKey: ["action", "list-sessions"] });
    } finally {
      setDeletingId(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit(question);
    }
  }

  const sessions = sessionsData?.sessions ?? [];

  return (
    <div className="flex flex-col items-center min-h-screen bg-background px-4 py-12 gap-10">
      {/* Header */}
      <div className="flex flex-col items-center gap-3 text-center max-w-xl">
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 text-primary">
          <IconBook2 className="h-6 w-6" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Knowledge</h1>
        <p className="text-muted-foreground text-sm">
          Look up data models, metrics definitions, and dashboards — answers are
          saved and citable.
        </p>
      </div>

      {/* Search */}
      <div className="w-full max-w-2xl flex flex-col gap-5">
        <div className="relative flex items-center rounded-xl border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <IconSearch className="absolute left-3.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search models, metrics, or dashboards…"
            className="flex-1 bg-transparent py-3.5 pl-10 pr-14 text-sm outline-none placeholder:text-muted-foreground"
            disabled={isPending}
          />
          <Button
            size="icon"
            className="absolute right-2 h-7 w-7"
            disabled={!question.trim() || isPending}
            onClick={() => handleSubmit(question)}
          >
            {isPending ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <IconArrowRight className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        {/* Category suggestions — always visible */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {CATEGORIES.map((cat) => (
            <div
              key={cat.label}
              className="flex flex-col gap-1 rounded-xl border bg-card p-3"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                {cat.icon}
                {cat.label}
              </div>
              {cat.questions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleSubmit(q)}
                  className={cn(
                    "text-left rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
                    isPending && "pointer-events-none opacity-50",
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Recent lookups */}
      <div className="w-full max-w-2xl flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconClock className="h-4 w-4" />
          Recent lookups
        </div>

        {sessionsLoading && (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        )}

        {!sessionsLoading && sessions.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <IconDatabaseSearch className="h-8 w-8 opacity-30" />
            <p>No lookups yet. Ask a question above to get started.</p>
          </div>
        )}

        {sessions.map((s) => (
          <Link
            key={s.id}
            to={`/knowledge/answer/${s.id}`}
            className="group relative flex items-start justify-between rounded-lg border bg-card px-4 py-3 text-sm hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <IconSearch className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{s.question}</span>
                  <span className="text-[11px] font-mono text-muted-foreground/50 shrink-0">
                    {refId(s.id)}
                  </span>
                </div>
                {s.preview && (
                  <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-1">
                    {s.preview}
                  </p>
                )}
                {!s.preview && s.status !== "done" && (
                  <p className="text-[12px] text-muted-foreground/60 mt-0.5 italic">
                    {s.status === "generating"
                      ? "Looking up sources…"
                      : "Waiting to process…"}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] text-muted-foreground/50">
                    {relativeTime(s.updatedAt ?? s.createdAt)}
                  </span>
                  {(s.sourceCount ?? 0) > 0 && (
                    <span className="text-[11px] text-muted-foreground/50">
                      · {s.sourceCount}{" "}
                      {s.sourceCount === 1 ? "source" : "sources"}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3 mt-0.5">
              <Badge variant={statusVariant(s.status)}>
                {statusLabel(s.status)}
              </Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, s.id)}
                    disabled={deletingId === s.id}
                    className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 hover:bg-destructive/10 hover:text-destructive text-muted-foreground/50"
                    aria-label="Delete lookup"
                  >
                    {deletingId === s.id ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <IconTrash className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
