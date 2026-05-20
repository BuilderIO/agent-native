import { useEffect, useState } from "react";
import {
  AgentChatSurface,
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconArrowRight,
  IconAlertTriangle,
  IconBook2,
  IconBolt,
  IconChecks,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleDot,
  IconClock,
  IconDatabase,
  IconLoader2,
  IconMessageCircle,
  IconPlayerPlay,
  IconReportAnalytics,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router";
import { type BrainHealthResponse, type BrainHealthStep } from "@/lib/brain";
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
  const healthQuery = useActionQuery<BrainHealthResponse>(
    "get-brain-health" as any,
    {} as any,
  );
  const seedDemo = useActionMutation<
    DemoSeedResponse,
    { publishCanonical: boolean }
  >("seed-demo-data" as any);
  const runDemoEval = useActionMutation<
    DemoEvalResponse,
    { seedIfMissing: boolean; publishCanonical: boolean }
  >("run-demo-eval" as any);

  const health = healthQuery.data;
  const firstRunReady =
    !healthQuery.isLoading && Boolean(health?.setup.firstRun);
  const sourceCount = health?.sources.total ?? 0;
  const healthySources = health?.sources.healthy ?? 0;
  const reviewCount = health?.proposals.pending ?? 0;

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
            health={health}
            loadingHealth={healthQuery.isLoading}
            status={demoStatus}
            message={demoMessage}
            onLoadDemoAndAsk={() => void loadDemo(true)}
            onRunEval={() => void runEvalOnly()}
          />
        }
        chatNotice={
          <BrainChatNotice
            health={health}
            sources={sourceCount}
            healthySources={healthySources}
            reviewCount={reviewCount}
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

function shortDate(value?: string | null) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function BrainDemoPrompt({
  busy,
  firstRunReady,
  health,
  loadingHealth,
  status,
  message,
  onLoadDemoAndAsk,
  onRunEval,
}: {
  busy: boolean;
  firstRunReady: boolean;
  health?: BrainHealthResponse;
  loadingHealth: boolean;
  status: DemoStatus;
  message: string | null;
  onLoadDemoAndAsk: () => void;
  onRunEval: () => void;
}) {
  const demoReady = status === "ready";
  const setup = health?.setup;
  const steps = setup?.steps ?? [];
  const nextStep = setup?.nextSteps[0];

  return (
    <div className="flex w-full max-w-[420px] flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <IconBolt className="size-4 text-primary" />
            First five minutes
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {firstRunReady
              ? "Load a cited demo, then connect one real source when you are ready."
              : "Keep Brain useful by checking source coverage, review work, and retrieval confidence."}
          </p>
        </div>
        {setup ? (
          <Badge variant="outline" className="shrink-0">
            {setup.completed}/{setup.total}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-2 rounded-md border border-border bg-muted/25 p-3">
        {loadingHealth && !steps.length ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <IconLoader2 className="size-4 animate-spin" />
            Checking setup
          </div>
        ) : steps.length ? (
          steps.map((step) => <SetupStepRow key={step.id} step={step} />)
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">
            Health is unavailable right now. The demo still works without a
            source connection.
          </p>
        )}
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
        <Button asChild size="sm" variant="ghost" className="justify-center">
          <Link to="/sources">Sources</Link>
        </Button>
      </div>
      {message ? <DemoStatusText status={status} message={message} /> : null}
      {nextStep && !message ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Next: {nextStep}
        </p>
      ) : null}

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

function SetupStepRow({ step }: { step: BrainHealthStep }) {
  const Icon =
    step.status === "done"
      ? IconCircleCheck
      : step.status === "next"
        ? IconCircleDot
        : IconCircleDashed;
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon
        className={
          step.status === "done"
            ? "mt-0.5 size-4 shrink-0 text-primary"
            : "mt-0.5 size-4 shrink-0 text-muted-foreground"
        }
      />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{step.label}</p>
        <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
          {step.detail}
        </p>
      </div>
    </div>
  );
}

function BrainChatNotice({
  health,
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
  health?: BrainHealthResponse;
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
  const attentionCount =
    (health?.sources.needsSetup ?? 0) +
    (health?.sources.needsSync ?? 0) +
    (health?.sources.stale ?? 0) +
    (health?.sources.error ?? 0);
  const lastEval = health?.retrieval.lastEval;
  const nextStep = health?.setup.nextSteps[0];
  const queueIssues =
    (health?.distillationQueue.failed ?? 0) +
    (health?.distillationQueue.stale ?? 0);
  const rawFallback =
    (health?.captures.counts?.queued ?? 0) +
    (health?.captures.counts?.distilling ?? 0);
  const citationCoverage = lastEval ? Math.round(lastEval.score * 100) : null;

  return (
    <div className="grid gap-3 border-t border-border bg-background/95 px-3 py-3 lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="min-w-0">
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <IconMessageCircle className="size-3" />
            Answer quality
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <IconShieldCheck className="size-3" />
            Cited, review-gated
          </Badge>
          {message ? (
            <DemoStatusText status={status} message={message} inline />
          ) : nextStep ? (
            <span className="max-w-[520px] truncate text-xs text-muted-foreground">
              Next: {nextStep}
            </span>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <TrustMetric
            icon={IconReportAnalytics}
            label="Citation coverage"
            value={citationCoverage === null ? "n/a" : `${citationCoverage}%`}
            detail={lastEval ? "latest eval" : "no eval yet"}
            tone={
              citationCoverage === null
                ? "neutral"
                : citationCoverage >= 80
                  ? "good"
                  : "warning"
            }
          />
          <TrustMetric
            icon={IconChecks}
            label="Proposal backlog"
            value={reviewCount}
            detail="waiting review"
            tone={reviewCount ? "warning" : "good"}
          />
          <TrustMetric
            icon={IconDatabase}
            label="Queue health"
            value={queueIssues ? queueIssues : "clear"}
            detail={`${health?.distillationQueue.pending ?? 0} pending`}
            tone={queueIssues ? "danger" : "good"}
          />
          <TrustMetric
            icon={IconBolt}
            label="Raw fallback"
            value={rawFallback ? rawFallback : "off"}
            detail={`${health?.captures.total ?? 0} captures`}
            tone={rawFallback ? "warning" : "good"}
          />
          <TrustMetric
            icon={IconClock}
            label="Latest eval"
            value={lastEval ? `${lastEval.passed}/${lastEval.total}` : "none"}
            detail={lastEval ? shortDate(lastEval.ranAt) : "not run"}
            tone={lastEval?.ok ? "good" : lastEval ? "warning" : "neutral"}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 lg:justify-end">
        <Badge variant="outline" className="gap-1.5">
          <IconDatabase className="size-3" />
          {healthySources}/{sources} sources healthy
        </Badge>
        {attentionCount > 0 ? (
          <Badge variant="outline" className="gap-1.5">
            <IconAlertTriangle className="size-3" />
            {attentionCount} need attention
          </Badge>
        ) : null}
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

function TrustMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof IconReportAnalytics;
  label: string;
  value: string | number;
  detail: string;
  tone: "neutral" | "good" | "warning" | "danger";
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span className="truncate text-sm font-semibold tabular-nums text-foreground">
          {value}
        </span>
        <span
          className={
            tone === "good"
              ? "size-2 rounded-full bg-primary"
              : tone === "warning"
                ? "size-2 rounded-full bg-amber-500"
                : tone === "danger"
                  ? "size-2 rounded-full bg-destructive"
                  : "size-2 rounded-full bg-muted-foreground"
          }
        />
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
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
