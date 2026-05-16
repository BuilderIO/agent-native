import { useEffect, useMemo, useState } from "react";
import {
  AgentChatSurface,
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconArrowRight,
  IconBook2,
  IconBolt,
  IconChecks,
  IconDatabase,
  IconLoader2,
  IconMessageCircle,
  IconPlayerPlay,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router";
import {
  type ReviewQueueResponse,
  type SourcesResponse,
  sourceHealth,
} from "@/lib/brain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const assistantSuggestions = [
  "What were the most important product decisions we made recently, and why?",
  "Which in-development Brain features are ready to explain with citations?",
  "What unresolved company questions are waiting for review?",
  "What customer context should I know before this week's roadmap discussion?",
];

const demoQuestion =
  "Using the Brain demo corpus, answer with citations: Why did we retire freemium, and what replaced it?";

type DemoStatus = "idle" | "loading" | "evaluating" | "asking" | "ready";

interface DemoSeedResponse {
  sources: unknown[];
  knowledge: unknown[];
}

interface DemoEvalResponse {
  ok: boolean;
  passed: number;
  total: number;
}

export default function AskRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [demoStatus, setDemoStatus] = useState<DemoStatus>(
    demoStatusFromParam(searchParams.get("demoStatus")) ?? "idle",
  );
  const [demoMessage, setDemoMessage] = useState<string | null>(null);
  const reviewQuery = useActionQuery<ReviewQueueResponse>(
    "list-proposals" as any,
    {} as any,
  );
  const sourcesQuery = useActionQuery<SourcesResponse>(
    "list-sources" as any,
    { includeArchived: false } as any,
  );
  const seedDemo = useActionMutation<
    DemoSeedResponse,
    { publishCanonical: boolean }
  >("seed-demo-data" as any);
  const runDemoEval = useActionMutation<
    DemoEvalResponse,
    { seedIfMissing: boolean; publishCanonical: boolean }
  >("run-demo-eval" as any);

  const reviewItems =
    reviewQuery.data?.items ?? reviewQuery.data?.proposals ?? [];
  const sources = sourcesQuery.data?.sources ?? [];
  const firstRunReady =
    !sourcesQuery.isLoading &&
    !reviewQuery.isLoading &&
    sources.length === 0 &&
    reviewItems.length === 0;
  const healthySources = useMemo(
    () => sources.filter((source) => sourceHealth(source) === "healthy").length,
    [sources],
  );

  const demoBusy =
    seedDemo.isPending ||
    runDemoEval.isPending ||
    demoStatus === "loading" ||
    demoStatus === "evaluating" ||
    demoStatus === "asking";

  useEffect(() => {
    if (searchParams.get("demo") !== "product-decisions") return;
    const routeStatus = demoStatusFromParam(searchParams.get("demoStatus"));
    if (routeStatus && routeStatus !== demoStatus) {
      setDemoStatus(routeStatus);
    }
  }, [demoStatus, searchParams]);

  function setDemoRouteState(status: DemoStatus) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("demo", "product-decisions");
        next.set("demoStatus", status);
        if (status === "asking" || status === "ready") {
          next.set("ask", "retired-freemium");
        } else {
          next.delete("ask");
        }
        return next;
      },
      { replace: true },
    );
  }

  async function loadDemo(askAfterLoad: boolean) {
    try {
      setDemoStatus("loading");
      setDemoRouteState("loading");
      setDemoMessage(
        "Loading demo sources, cited knowledge, and review queue.",
      );
      const seeded = await seedDemo.mutateAsync({ publishCanonical: true });
      setDemoMessage(
        `Loaded ${seeded.sources.length} sources, ${seeded.knowledge.length} knowledge entries, and 1 review proposal.`,
      );

      if (!askAfterLoad) {
        setDemoStatus("ready");
        setDemoRouteState("ready");
        toast.success("Brain demo loaded");
        return;
      }

      setDemoStatus("evaluating");
      setDemoRouteState("evaluating");
      const evalResult = await runDemoEval.mutateAsync({
        seedIfMissing: false,
        publishCanonical: true,
      });
      setDemoMessage(
        evalResult.ok
          ? `Demo eval passed ${evalResult.passed}/${evalResult.total}. Asking the cited question now.`
          : `Demo loaded. Eval passed ${evalResult.passed}/${evalResult.total}; asking the cited question now.`,
      );

      setDemoStatus("asking");
      setDemoRouteState("asking");
      sendToAgentChat({
        message: demoQuestion,
        submit: true,
        newTab: true,
        openSidebar: false,
      });
      setDemoStatus("ready");
      setDemoRouteState("ready");
      toast.success("Demo loaded and question sent");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not load Brain demo.";
      setDemoStatus("idle");
      setDemoMessage(message);
      toast.error(message);
    }
  }

  async function runEvalOnly() {
    try {
      setDemoStatus("evaluating");
      setDemoRouteState("evaluating");
      setDemoMessage("Running the demo eval against the current corpus.");
      const evalResult = await runDemoEval.mutateAsync({
        seedIfMissing: true,
        publishCanonical: true,
      });
      setDemoStatus("ready");
      setDemoRouteState("ready");
      setDemoMessage(
        `Demo eval ${evalResult.ok ? "passed" : "finished"} ${
          evalResult.passed
        }/${evalResult.total} checks.`,
      );
      toast[evalResult.ok ? "success" : "warning"](
        `Demo eval ${evalResult.passed}/${evalResult.total}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not run demo eval.";
      setDemoStatus("idle");
      setDemoMessage(message);
      toast.error(message);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        className="brain-chat-panel"
        defaultMode="chat"
        emptyStateText="Ask Brain about company memory."
        suggestions={assistantSuggestions}
        emptyStateAddon={
          <BrainDemoPrompt
            busy={demoBusy}
            firstRunReady={firstRunReady}
            status={demoStatus}
            message={demoMessage}
            onLoadDemoAndAsk={() => void loadDemo(true)}
            onRunEval={() => void runEvalOnly()}
          />
        }
        chatNotice={
          <BrainChatNotice
            sources={sources.length}
            healthySources={healthySources}
            reviewCount={reviewItems.length}
            firstRunReady={firstRunReady}
            busy={demoBusy}
            status={demoStatus}
            message={demoMessage}
            onLoadDemoAndAsk={() => void loadDemo(true)}
            onRunEval={() => void runEvalOnly()}
          />
        }
      />
    </div>
  );
}

function demoStatusFromParam(value: string | null): DemoStatus | null {
  if (
    value === "idle" ||
    value === "loading" ||
    value === "evaluating" ||
    value === "asking" ||
    value === "ready"
  ) {
    return value;
  }
  return null;
}

function BrainDemoPrompt({
  busy,
  firstRunReady,
  status,
  message,
  onLoadDemoAndAsk,
  onRunEval,
}: {
  busy: boolean;
  firstRunReady: boolean;
  status: DemoStatus;
  message: string | null;
  onLoadDemoAndAsk: () => void;
  onRunEval: () => void;
}) {
  const demoReady = status === "ready";

  return (
    <div className="flex w-full max-w-[420px] flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <IconBolt className="size-4 text-primary" />
            Product-decision demo
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {firstRunReady
              ? "Seed a small, cited corpus and ask the launch question in one step."
              : "Replay the product-decision demo without changing your real source setup."}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          size="sm"
          className="justify-center gap-1.5 sm:flex-1"
          disabled={busy}
          onClick={onLoadDemoAndAsk}
        >
          {busy ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : (
            <IconPlayerPlay className="size-4" />
          )}
          Start demo
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="justify-center"
          disabled={busy}
          onClick={onRunEval}
        >
          Run eval
        </Button>
      </div>
      {message ? <DemoStatusText status={status} message={message} /> : null}

      {demoReady ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button asChild variant="ghost" size="sm" className="gap-1.5 px-2">
            <Link to="/review">
              Review queue
              <IconArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="gap-1.5 px-2">
            <Link to="/knowledge">
              Knowledge
              <IconArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function BrainChatNotice({
  sources,
  healthySources,
  reviewCount,
  firstRunReady,
  busy,
  status,
  message,
  onLoadDemoAndAsk,
  onRunEval,
}: {
  sources: number;
  healthySources: number;
  reviewCount: number;
  firstRunReady: boolean;
  busy: boolean;
  status: DemoStatus;
  message: string | null;
  onLoadDemoAndAsk: () => void;
  onRunEval: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 bg-background/95 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1.5">
          <IconMessageCircle className="size-3" />
          Company memory chat
        </Badge>
        <Badge variant="outline" className="gap-1.5">
          <IconShieldCheck className="size-3" />
          Cited, review-gated
        </Badge>
        <Badge variant="outline" className="gap-1.5">
          <IconDatabase className="size-3" />
          {healthySources}/{sources} sources healthy
        </Badge>
        {reviewCount > 0 ? (
          <Badge variant="outline" className="gap-1.5">
            <IconChecks className="size-3" />
            {reviewCount} to review
          </Badge>
        ) : null}
        {message ? (
          <DemoStatusText status={status} message={message} inline />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
        {firstRunReady || status !== "idle" ? (
          <Button
            variant={firstRunReady ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            disabled={busy}
            onClick={onLoadDemoAndAsk}
          >
            {busy ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconPlayerPlay className="size-4" />
            )}
            Start demo
          </Button>
        ) : null}
        {status === "ready" ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onRunEval}
            >
              Run eval
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/review">
                <IconChecks className="size-4" />
                Review
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/knowledge">
                <IconBook2 className="size-4" />
                Knowledge
              </Link>
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function DemoStatusText({
  status,
  message,
  inline = false,
}: {
  status: DemoStatus;
  message: string;
  inline?: boolean;
}) {
  return (
    <span
      className={
        inline
          ? "max-w-[520px] truncate text-xs text-muted-foreground"
          : "text-xs leading-5 text-muted-foreground"
      }
    >
      {status === "ready" ? "Demo ready: " : ""}
      {message}
    </span>
  );
}
