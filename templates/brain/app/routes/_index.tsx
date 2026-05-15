import { FormEvent, useMemo, useState } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconArrowRight,
  IconBook2,
  IconChecks,
  IconFlask,
  IconQuote,
  IconReportAnalytics,
  IconSearch,
} from "@tabler/icons-react";
import { Link } from "react-router";
import {
  type AskBrainResponse,
  type DemoEvalResponse,
  type DemoSeedResponse,
  type KnowledgeResponse,
  type ReviewQueueResponse,
  type SourcesResponse,
  formatPercent,
  sampleKnowledgeRows,
  sampleReviewItems,
  sampleSources,
  sourceHealth,
  sourceLastSync,
  sourceName,
  sourceType,
} from "@/lib/brain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyActionState,
  MetricCard,
  PageHeader,
  PriorityBadge,
  StatusBadge,
} from "@/components/brain/Surface";

const starterQuestions = [
  "Why did we retire freemium?",
  "How does Decision Digest work and why?",
  "Why are product decisions the lead Brain demo?",
];

export default function AskRoute() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskBrainResponse | null>(null);
  const [evalResult, setEvalResult] = useState<DemoEvalResponse | null>(null);

  const knowledgeQuery = useActionQuery<KnowledgeResponse>(
    "search-knowledge" as any,
    { limit: 8 } as any,
  );
  const reviewQuery = useActionQuery<ReviewQueueResponse>(
    "list-proposals" as any,
    {} as any,
  );
  const sourcesQuery = useActionQuery<SourcesResponse>(
    "list-sources" as any,
    {
      includeArchived: false,
    } as any,
  );
  const askBrain = useActionMutation<
    AskBrainResponse,
    { question: string; mode: "cited"; filters?: Record<string, string> }
  >("ask-brain" as any);
  const seedDemo = useActionMutation<
    DemoSeedResponse,
    { publishCanonical: boolean }
  >("seed-demo-data" as any);
  const runDemoEval = useActionMutation<
    DemoEvalResponse,
    { seedIfMissing: boolean; publishCanonical: boolean }
  >("run-demo-eval" as any);

  const knowledgeRows =
    knowledgeQuery.data?.rows ?? knowledgeQuery.data?.knowledge;
  const knowledge = knowledgeRows?.length ? knowledgeRows : sampleKnowledgeRows;
  const reviewItems = reviewQuery.data?.items ?? reviewQuery.data?.proposals;
  const reviewQueue = reviewItems?.length ? reviewItems : sampleReviewItems;
  const sources = sourcesQuery.data?.sources?.length
    ? sourcesQuery.data.sources
    : sampleSources;

  const healthySources = useMemo(
    () => sources.filter((source) => sourceHealth(source) === "healthy").length,
    [sources],
  );
  const metrics = [
    {
      label: "Facts indexed",
      value: knowledge.length,
      detail: knowledgeQuery.isError
        ? "search-knowledge pending"
        : "Searchable rows",
      tone: "good" as const,
    },
    {
      label: "Needs review",
      value: reviewQueue.length,
      detail: reviewQuery.isError ? "list-proposals pending" : "Open proposals",
      tone: reviewQueue.length ? ("warning" as const) : ("good" as const),
    },
    {
      label: "Source health",
      value: sources.length
        ? formatPercent(healthySources / sources.length)
        : "0%",
      detail: `${healthySources}/${sources.length} healthy`,
      tone:
        healthySources === sources.length
          ? ("good" as const)
          : healthySources
            ? ("warning" as const)
            : ("danger" as const),
    },
    {
      label: "Citation coverage",
      value: "Cited",
      detail: "Ask requires evidence",
      tone: "neutral" as const,
    },
  ];

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    try {
      const response = await askBrain.mutateAsync({
        question: trimmed,
        mode: "cited",
      });
      setAnswer(response);
    } catch {
      setAnswer(null);
    }
  }

  async function loadDemo() {
    const response = await seedDemo.mutateAsync({ publishCanonical: true });
    setQuestion(response.suggestedQuestions?.[0] ?? starterQuestions[0]);
    setAnswer(null);
  }

  async function runEval() {
    const response = await runDemoEval.mutateAsync({
      seedIfMissing: true,
      publishCanonical: false,
    });
    setEvalResult(response);
  }

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow="Ask"
        title="Ask Brain"
        description="Query whole-company memory with citations, source health, and reviewable evidence in the same working surface."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={seedDemo.isPending}
              onClick={loadDemo}
            >
              <IconFlask className="size-4" />
              {seedDemo.isPending ? "Seeding" : "Load demo"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={runDemoEval.isPending}
              onClick={runEval}
            >
              <IconReportAnalytics className="size-4" />
              {runDemoEval.isPending ? "Running" : "Run eval"}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/knowledge">
                <IconBook2 className="size-4" />
                Knowledge
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/review">
                <IconChecks className="size-4" />
                Review queue
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-7">
        <section className="grid min-w-0 gap-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Company memory query</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="grid gap-3">
                <Textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about policies, customers, product decisions, sales rules, incidents, or internal process..."
                  className="min-h-32 resize-none text-base leading-7"
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-2">
                    {starterQuestions.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => setQuestion(starter)}
                        className="rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="submit"
                    disabled={askBrain.isPending || !question.trim()}
                    className="shrink-0"
                  >
                    <IconSearch className="size-4" />
                    {askBrain.isPending ? "Asking" : "Ask"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {answer ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Cited answer</CardTitle>
                  <Badge variant="secondary">
                    {answer.citations.length} citations
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <p className="text-sm leading-7 text-foreground">
                  {answer.answer}
                </p>
                <div className="grid gap-3">
                  {answer.citations.map((citation) => (
                    <div
                      key={citation.id}
                      className="rounded-md border border-border bg-muted/30 p-3"
                    >
                      <div className="flex items-start gap-3">
                        <IconQuote className="mt-1 size-4 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {citation.title}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {citation.sourceName}
                            {citation.confidence
                              ? ` · ${Math.round(citation.confidence * 100)}% confidence`
                              : null}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {citation.excerpt}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : askBrain.isError ? (
            <EmptyActionState
              title="Waiting on the ask-brain action"
              detail="The Ask surface is wired to the intended backend action. Once that action exists, cited answers will render here."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {knowledge.slice(0, 3).map((row) => (
                <Card key={row.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="line-clamp-2 text-sm">
                        {row.title}
                      </CardTitle>
                      <StatusBadge status={row.status} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                      {row.summary ?? row.body ?? "No summary yet."}
                    </p>
                    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="truncate">
                        {row.sourceName ?? row.sourceId ?? "Source"}
                      </span>
                      <span>{row.citations ?? 0} cites</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        <aside className="grid content-start gap-5">
          <div className="grid grid-cols-2 gap-3">
            {metrics.map((metric) => (
              <MetricCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                detail={metric.detail}
                tone={metric.tone}
              />
            ))}
          </div>

          {evalResult ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Demo eval</CardTitle>
                  <Badge variant={evalResult.ok ? "secondary" : "outline"}>
                    {evalResult.passed}/{evalResult.total}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Progress value={evalResult.score * 100} />
                <div className="grid gap-2">
                  {evalResult.checks.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-md border border-border bg-background p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium">{item.label}</p>
                        <Badge
                          variant={item.passed ? "secondary" : "outline"}
                          className="shrink-0"
                        >
                          {item.passed ? "Pass" : "Check"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">Source health</CardTitle>
                <Badge variant="outline">
                  {healthySources}/{sources.length} healthy
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {sources.slice(0, 4).map((source) => (
                <Link
                  key={source.id}
                  to={`/sources?sourceId=${encodeURIComponent(source.id)}`}
                  className="rounded-md border border-border bg-background p-3 transition-colors hover:bg-accent/60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {sourceName(source)}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {sourceType(source)} ·{" "}
                        {sourceLastSync(source) ?? "Not synced"}
                      </p>
                    </div>
                    <StatusBadge status={sourceHealth(source)} />
                  </div>
                </Link>
              ))}
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="justify-between"
              >
                <Link to="/sources">
                  Configure sources
                  <IconArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">Review queue</CardTitle>
                <Badge variant="outline">{reviewQueue.length} queued</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {reviewQueue.slice(0, 3).map((item) => (
                <Link
                  key={item.id}
                  to={`/review?reviewItemId=${encodeURIComponent(item.id)}`}
                  className="rounded-md border border-border bg-background p-3 transition-colors hover:bg-accent/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-2 text-sm font-medium">
                      {item.title}
                    </p>
                    <PriorityBadge priority={item.priority} />
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {item.reason}
                  </p>
                </Link>
              ))}
            </CardContent>
          </Card>

          {knowledgeQuery.isError ||
          reviewQuery.isError ||
          sourcesQuery.isError ||
          seedDemo.isError ||
          runDemoEval.isError ? (
            <EmptyActionState
              title="Some Brain actions need attention"
              detail="Ask is wired to search, review, source, demo seed, and demo eval actions. Check the action error for details."
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
