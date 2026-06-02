import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IconSearch,
  IconClock,
  IconBook2,
  IconArrowRight,
  IconLoader2,
  IconTable,
  IconChartBar,
  IconLayoutDashboard,
} from "@tabler/icons-react";

/** First 6 chars of the UUID used as a short human-readable reference, e.g. KQ-d8e0cb */
function refId(id: string) {
  return `KQ-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
import { cn } from "@/lib/utils";
import { Link } from "react-router";

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

function statusLabel(status: string) {
  if (status === "done") return "answered";
  if (status === "error") return "error";
  return "pending";
}

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done") return "secondary";
  if (status === "error") return "destructive";
  return "outline";
}

export default function KnowledgeHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: sessionsData, isLoading: sessionsLoading } = useActionQuery(
    "list-sessions",
    {},
    { staleTime: 10_000 },
  );

  const { mutateAsync: askQuestion, isPending } =
    useActionMutation("ask-question");

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

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit(question);
    }
  }

  const sessions = sessionsData?.sessions ?? [];

  return (
    <div className="flex flex-col items-center min-h-screen bg-background px-4 py-16 gap-10">
      {/* Header */}
      <div className="flex flex-col items-center gap-3 text-center max-w-xl">
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 text-primary">
          <IconBook2 className="h-6 w-6" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Data Reference
        </h1>
        <p className="text-muted-foreground text-sm">
          Look up data models, metrics definitions, and dashboards — answers are
          saved and citable.
        </p>
      </div>

      {/* Search input */}
      <div className="w-full max-w-2xl flex flex-col gap-4">
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

        {/* Category chips */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat, i) => (
            <button
              key={cat.label}
              type="button"
              onClick={() => setActiveCategory(activeCategory === i ? null : i)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                activeCategory === i
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                isPending && "pointer-events-none opacity-50",
              )}
            >
              {cat.icon}
              {cat.label}
            </button>
          ))}
        </div>

        {/* Expanded category questions */}
        {activeCategory !== null && (
          <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-3">
            {CATEGORIES[activeCategory].questions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleSubmit(q)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
                  isPending && "pointer-events-none opacity-50",
                )}
              >
                <IconArrowRight className="h-3.5 w-3.5 shrink-0 opacity-40" />
                {q}
              </button>
            ))}
          </div>
        )}
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
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        )}

        {!sessionsLoading && sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No lookups yet. Search above to get started.
          </p>
        )}

        {sessions.map((s) => (
          <Link
            key={s.id}
            to={`/knowledge/answer/${s.id}`}
            className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm hover:bg-muted/50 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <IconSearch className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <span className="truncate block">{s.question}</span>
                <span className="text-[11px] font-mono text-muted-foreground/60">
                  {refId(s.id)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              <Badge variant={statusVariant(s.status)}>
                {statusLabel(s.status)}
              </Badge>
              <IconArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
