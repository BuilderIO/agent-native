import { useState, useRef } from "react";
import { useNavigate } from "react-router";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IconSearch,
  IconClock,
  IconMessageCircle,
  IconArrowRight,
  IconLoader2,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Link } from "react-router";

const SUGGESTED_QUESTIONS = [
  "What fields does dim_contracts have?",
  "How is ARR calculated in our dbt models?",
  "What does the fct_subscriptions model contain?",
  "Where is churned MRR tracked?",
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(question);
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setQuestion(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  const sessions = sessionsData?.sessions ?? [];

  return (
    <div className="flex flex-col items-center min-h-screen bg-background px-4 py-16 gap-10">
      {/* Header */}
      <div className="flex flex-col items-center gap-3 text-center max-w-xl">
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 text-primary">
          <IconMessageCircle className="h-6 w-6" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Knowledge Assistant
        </h1>
        <p className="text-muted-foreground text-sm">
          Ask anything about your dbt models, SQL tables, or data definitions.
          Answers are sourced from dbt MCP and GitHub.
        </p>
      </div>

      {/* Question input */}
      <div className="w-full max-w-2xl flex flex-col gap-3">
        <div className="relative flex flex-col rounded-xl border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <Textarea
            ref={textareaRef}
            value={question}
            onChange={autoResize}
            onKeyDown={handleKeyDown}
            placeholder="Ask about a model, metric, or table…"
            className="resize-none border-0 shadow-none focus-visible:ring-0 min-h-[56px] py-4 pr-14 text-base bg-transparent"
            rows={1}
          />
          <Button
            size="icon"
            className="absolute right-3 bottom-3"
            disabled={!question.trim() || isPending}
            onClick={() => handleSubmit(question)}
          >
            {isPending ? (
              <IconLoader2 className="h-4 w-4 animate-spin" />
            ) : (
              <IconArrowRight className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Suggested questions */}
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => handleSubmit(q)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                isPending && "pointer-events-none opacity-50",
              )}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Recent questions */}
      <div className="w-full max-w-2xl flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconClock className="h-4 w-4" />
          Recent questions
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
            No questions yet. Ask something above to get started.
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
              <span className="truncate">{s.question}</span>
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
