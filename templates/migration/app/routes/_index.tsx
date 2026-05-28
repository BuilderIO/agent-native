import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  IconCheck,
  IconDeviceFloppy,
  IconFileText,
  IconListCheck,
  IconPlayerPlay,
  IconRoute,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

type RunSummary = {
  id: string;
  name: string;
  sourceRoot: string;
  inputKind?: string;
  inputDescription?: string;
  outputRoot: string;
  target: string;
  phase: string;
  approved: boolean;
  taskCount: number;
  passedTaskCount: number;
  coveredTaskCount: number;
  failedTaskCount: number;
  hasPlanInputs?: boolean;
  updatedAt: string;
};

type AssessmentSource = {
  source: string;
  sourceLabel: string;
  needsAgentIntrospection: boolean;
  inputKind?: string;
  inputDescription?: string;
};

type GoalResult = {
  status: string;
  approvalRequired: boolean;
  assessmentSource: AssessmentSource | null;
  criticDecision: string | null;
  nextAction: string;
  taskSummary: {
    total: number;
    pending: number;
    running: number;
    passed: number;
    covered: number;
    failed: number;
    manual: number;
  };
  verification: {
    ok: boolean | null;
    results: Array<{
      id: string;
      ok: boolean;
      severity: string;
      summary: string;
    }>;
  };
};

type GoalBadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function meta() {
  return [
    { title: "Code Agents /migrate" },
    {
      name: "description",
      content:
        "Internal run surface for the Code Agents /migrate goal: assessment, approval, tasks, artifacts, and deterministic verification.",
    },
  ];
}

export default function MigrateGoalSurfacePage() {
  useSetPageTitle("Code Agents /migrate");
  const [searchParams, setSearchParams] = useSearchParams();
  const runIdFromUrl = searchParams.get("run");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [goalResult, setGoalResult] = useState<GoalResult | null>(null);
  const [name, setName] = useState("/migrate run");
  const [sourceRoot, setSourceRoot] = useState("");
  const [outputRoot, setOutputRoot] = useState("../migrated-app");
  const [planInputsText, setPlanInputsText] = useState("");
  const [selectedPlanInputsText, setSelectedPlanInputsText] = useState("");
  const newRunPlanInputsSeedRef = useRef<string | null>(null);
  const selectedPlanInputsSeedRef = useRef<{
    runId: string;
    text: string;
  } | null>(null);
  const runsQuery = useActionQuery("list-migration-runs", {});
  const seedQuery = useActionQuery("get-migration-seed", {});
  const runs = ((runsQuery.data as { runs?: RunSummary[] } | undefined)?.runs ??
    []) as RunSummary[];
  const selectedRun = useMemo(
    () =>
      runs.find((run) => run.id === runIdFromUrl) ??
      runs.find((run) => run.id === selectedRunId) ??
      runs[0],
    [runs, runIdFromUrl, selectedRunId],
  );
  const runQuery = useActionQuery(
    "get-migration-run",
    selectedRun ? { id: selectedRun.id } : ({} as any),
    { enabled: Boolean(selectedRun) } as any,
  );

  const createRun = useActionMutation("create-migration-run");
  const assess = useActionMutation("assess-migration");
  const plan = useActionMutation("generate-migration-plan");
  const approve = useActionMutation("approve-migration-plan");
  const updatePlanInputs = useActionMutation("update-migration-plan-inputs");
  const runTask = useActionMutation("run-migration-task");
  const runGoal = useActionMutation("run-migration-goal");
  const verify = useActionMutation("verify-migration");

  const detail = runQuery.data as
    | {
        run?: any;
        assessmentSource?: AssessmentSource | null;
        tasks?: Array<{
          id: string;
          recipeName: string;
          title: string;
          status: string;
          confidence: string;
          summary: string;
        }>;
        verifierResults?: Array<{
          id: string;
          ok: boolean;
          severity: string;
          summary: string;
        }>;
      }
    | undefined;

  useEffect(() => {
    if (!runIdFromUrl) return;
    setSelectedRunId(runIdFromUrl);
    setGoalResult(null);
  }, [runIdFromUrl]);

  useEffect(() => {
    const seed = (seedQuery.data as { seed?: any } | undefined)?.seed;
    if (!seed || sourceRoot) return;
    const seededSource =
      seed.source?.value ??
      seed.sourceRoot ??
      seed.sourceUrl ??
      seed.sourceDescription;
    if (typeof seededSource === "string") setSourceRoot(seededSource);
    if (typeof seed.outputRoot === "string") setOutputRoot(seed.outputRoot);
    if (typeof seed.name === "string") setName(seed.name);
    if (seed.planInputs) {
      const seedText = JSON.stringify(seed.planInputs, null, 2);
      const seedKey = `${seededSource ?? ""}:${seedText}`;
      if (newRunPlanInputsSeedRef.current !== seedKey && !planInputsText) {
        newRunPlanInputsSeedRef.current = seedKey;
        setPlanInputsText(seedText);
      }
    }
  }, [planInputsText, seedQuery.data, sourceRoot]);

  useEffect(() => {
    if (!selectedRun) return;
    const runDetail = detail?.run as
      | { planInputs?: unknown; planInputsText?: string }
      | undefined;
    const planInputs = runDetail?.planInputs;
    const nextText =
      typeof runDetail?.planInputsText === "string"
        ? runDetail.planInputsText
        : planInputs
          ? JSON.stringify(planInputs, null, 2)
          : "";
    const previousSeed = selectedPlanInputsSeedRef.current;
    const userEditedCurrentRun =
      previousSeed?.runId === selectedRun.id &&
      selectedPlanInputsText !== previousSeed.text;
    if (userEditedCurrentRun && selectedPlanInputsText !== nextText) return;
    selectedPlanInputsSeedRef.current = {
      runId: selectedRun.id,
      text: nextText,
    };
    if (selectedPlanInputsText !== nextText) {
      setSelectedPlanInputsText(nextText);
    }
  }, [detail?.run, selectedPlanInputsText, selectedRun]);

  function selectRun(id: string) {
    setSelectedRunId(id);
    setGoalResult(null);
    const next = new URLSearchParams(searchParams);
    next.set("run", id);
    setSearchParams(next);
  }

  async function create() {
    if (!sourceRoot.trim()) return;
    const result = (await createRun.mutateAsync({
      name,
      sourceRoot,
      outputRoot,
      target: "agent-native",
      inputDescription: (seedQuery.data as { seed?: any } | undefined)?.seed
        ?.sourceDescription,
      planInputsText: planInputsText.trim() || undefined,
    } as any)) as { run?: { id: string } };
    if (result.run?.id) selectRun(result.run.id);
    setSourceRoot("");
    setPlanInputsText("");
  }

  async function savePlanInputs() {
    if (!selectedRun) return;
    await updatePlanInputs.mutateAsync(
      selectedPlanInputsText.trim()
        ? {
            id: selectedRun.id,
            planInputsText: selectedPlanInputsText,
          }
        : { id: selectedRun.id, planInputs: null },
    );
  }

  async function runSelectedGoal() {
    if (!selectedRun) return;
    const result = (await runGoal.mutateAsync({
      id: selectedRun.id,
      maxTasks: 1,
      verify: true,
    } as any)) as GoalResult;
    setGoalResult(result);
  }

  const tasks = detail?.tasks ?? [];
  const progress =
    tasks.length > 0
      ? Math.round(
          (tasks.filter(isAdvancedTaskStatus).length / tasks.length) * 100,
        )
      : 0;
  const goalState = selectedRun
    ? describeGoalState(
        detail?.run ?? selectedRun,
        tasks,
        detail?.verifierResults ?? [],
      )
    : null;
  const selectedRunApproved = Boolean(
    detail?.run?.approved ?? selectedRun?.approved,
  );
  const assessmentSource =
    detail?.assessmentSource ?? goalResult?.assessmentSource ?? null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6 lg:px-8">
      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New /migrate run</CardTitle>
              <CardDescription>
                Start from a local path, URL, or description. This internal
                surface treats source as read-only and writes generated output
                somewhere else.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Run name"
              />
              <Textarea
                value={sourceRoot}
                onChange={(event) => setSourceRoot(event.target.value)}
                placeholder="/path/to/app, https://example.com, or a short migration brief"
                className="min-h-20"
              />
              <Input
                value={outputRoot}
                onChange={(event) => setOutputRoot(event.target.value)}
                placeholder="../migrated-app"
              />
              <Textarea
                value={planInputsText}
                onChange={(event) => setPlanInputsText(event.target.value)}
                placeholder="Optional custom plan JSON or notes"
                className="min-h-24 font-mono text-xs"
              />
              <Button
                onClick={create}
                disabled={!sourceRoot.trim() || createRun.isPending}
                className="w-full"
              >
                <IconRoute className="h-4 w-4" />
                Create /migrate run
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Runs</CardTitle>
              <CardDescription>
                Internal run details for the Code Agents /migrate goal.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {runsQuery.isLoading ? (
                <>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </>
              ) : runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No /migrate runs yet.
                </p>
              ) : (
                runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => selectRun(run.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selectedRun?.id === run.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{run.name}</p>
                      <Badge variant={run.approved ? "default" : "secondary"}>
                        {run.phase}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {run.inputKind ? `${run.inputKind}: ` : ""}
                      {run.sourceRoot}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{run.taskCount} tasks</span>
                      {run.passedTaskCount > 0 ? (
                        <span>{run.passedTaskCount} passed</span>
                      ) : null}
                      {run.coveredTaskCount > 0 ? (
                        <span>{run.coveredTaskCount} covered</span>
                      ) : null}
                      {run.hasPlanInputs ? <span>custom plan</span> : null}
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        <section className="min-w-0">
          {!selectedRun ? (
            <EmptyState />
          ) : (
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle>{selectedRun.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {selectedRun.inputKind
                        ? `${selectedRun.inputKind}: `
                        : ""}
                      {selectedRun.sourceRoot}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={runSelectedGoal}
                      disabled={runGoal.isPending}
                    >
                      <IconRoute className="h-4 w-4" />
                      {runGoal.isPending ? "Running goal" : "Run Goal"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setGoalResult(null);
                        assess.mutate({ id: selectedRun.id } as any);
                      }}
                      disabled={assess.isPending}
                    >
                      <IconFileText className="h-4 w-4" />
                      Assess
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setGoalResult(null);
                        plan.mutate({ id: selectedRun.id } as any);
                      }}
                      disabled={plan.isPending}
                    >
                      <IconListCheck className="h-4 w-4" />
                      Plan
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setGoalResult(null);
                        approve.mutate({ id: selectedRun.id } as any);
                      }}
                      disabled={approve.isPending || selectedRunApproved}
                    >
                      <IconCheck className="h-4 w-4" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setGoalResult(null);
                        runTask.mutate({ id: selectedRun.id } as any);
                      }}
                      disabled={runTask.isPending || !selectedRunApproved}
                    >
                      <IconPlayerPlay className="h-4 w-4" />
                      Run task
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setGoalResult(null);
                        verify.mutate({ id: selectedRun.id } as any);
                      }}
                      disabled={verify.isPending}
                    >
                      <IconShieldCheck className="h-4 w-4" />
                      Verify
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {assessmentSource?.needsAgentIntrospection ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">
                          Agent introspection fallback
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          This assessment is a skeleton inventory. Treat it as a
                          starting point until an agent has inspected source
                          code, CMS content, or the live app.
                        </p>
                      </div>
                      <Badge variant="outline">
                        {assessmentSource.sourceLabel}
                      </Badge>
                    </div>
                  </div>
                ) : null}

                {goalState ? (
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">/migrate goal</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {goalState.description}
                        </p>
                      </div>
                      <Badge variant={goalState.variant}>
                        {goalState.label}
                      </Badge>
                    </div>
                    {goalResult ? (
                      <div className="mt-3 rounded-md border border-border bg-background p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{goalResult.status}</Badge>
                          {goalResult.criticDecision ? (
                            <span className="text-muted-foreground">
                              Critic: {goalResult.criticDecision}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-muted-foreground">
                          {goalResult.nextAction}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {goalResult.taskSummary.passed} passed,{" "}
                          {goalResult.taskSummary.covered} covered,{" "}
                          {goalResult.taskSummary.pending} pending,{" "}
                          {goalResult.verification.results.length} verifier
                          result(s)
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid gap-3 md:grid-cols-4">
                  <Metric
                    label="Phase"
                    value={detail?.run?.phase ?? selectedRun.phase}
                  />
                  <Metric label="Target" value={selectedRun.target} />
                  <Metric label="Output" value={selectedRun.outputRoot} />
                  <Metric
                    label="Assessment"
                    value={assessmentSource?.sourceLabel ?? "Not assessed"}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Task sweep</span>
                    <span className="text-muted-foreground">{progress}%</span>
                  </div>
                  <Progress value={progress} />
                </div>

                <Tabs defaultValue="tasks">
                  <TabsList>
                    <TabsTrigger value="tasks">Tasks</TabsTrigger>
                    <TabsTrigger value="plan">Plan Inputs</TabsTrigger>
                    <TabsTrigger value="ir">IR</TabsTrigger>
                    <TabsTrigger value="verify">Verify</TabsTrigger>
                  </TabsList>
                  <TabsContent value="tasks" className="mt-4 space-y-2">
                    {tasks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Generate a plan to create task inventory.
                      </p>
                    ) : (
                      tasks.map((task) => (
                        <div
                          key={task.id}
                          className="rounded-lg border border-border p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">
                                {task.title}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {task.recipeName}
                              </p>
                            </div>
                            <Badge variant="outline">
                              {taskStatusLabel(task.status)}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {task.summary}
                          </p>
                        </div>
                      ))
                    )}
                  </TabsContent>
                  <TabsContent value="plan" className="mt-4 space-y-3">
                    {detail?.run?.planInputsParseError ? (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                        {detail.run.planInputsParseError}
                      </div>
                    ) : null}
                    <Textarea
                      value={selectedPlanInputsText}
                      onChange={(event) =>
                        setSelectedPlanInputsText(event.target.value)
                      }
                      disabled={Boolean(detail?.run?.planPath)}
                      placeholder="Paste JSON or planning notes before generating the plan."
                      className="min-h-56 font-mono text-xs"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        {detail?.run?.planPath
                          ? "Plan inputs are locked after plan generation."
                          : "Saved inputs are converted into migration tasks during planning."}
                      </p>
                      <Button
                        variant="outline"
                        onClick={savePlanInputs}
                        disabled={
                          !selectedRun ||
                          updatePlanInputs.isPending ||
                          Boolean(detail?.run?.planPath)
                        }
                      >
                        <IconDeviceFloppy className="h-4 w-4" />
                        Save
                      </Button>
                    </div>
                  </TabsContent>
                  <TabsContent value="ir" className="mt-4">
                    <pre className="max-h-[420px] overflow-auto rounded-lg bg-muted p-4 text-xs">
                      {JSON.stringify(detail?.run?.ir ?? {}, null, 2)}
                    </pre>
                  </TabsContent>
                  <TabsContent value="verify" className="mt-4 space-y-2">
                    {(detail?.verifierResults ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Run verification to see deterministic checks.
                      </p>
                    ) : (
                      detail!.verifierResults!.map((result) => (
                        <div
                          key={result.id}
                          className="rounded-lg border border-border p-3"
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">{result.id}</p>
                            <Badge
                              variant={result.ok ? "default" : "destructive"}
                            >
                              {result.ok ? "passed" : result.severity}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {result.summary}
                          </p>
                        </div>
                      ))
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function isAdvancedTaskStatus(task: { status: string }) {
  return task.status === "passed" || task.status === "covered";
}

function taskStatusLabel(status: string) {
  if (status === "covered") return "covered by scaffold";
  return status;
}

function describeGoalState(
  run: any,
  tasks: Array<{ status: string }>,
  verifierResults: Array<{ ok: boolean }>,
): { label: string; variant: GoalBadgeVariant; description: string } {
  const pending = tasks.filter((task) => task.status === "pending").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const failedTasks = tasks.filter((task) => task.status === "failed").length;
  const failedVerifiers = verifierResults.filter((result) => !result.ok).length;

  if (!run?.assessmentPath && !run?.ir) {
    return {
      label: "Ready",
      variant: "secondary",
      description:
        "Run Goal will assess the source and create a plan without writing generated output.",
    };
  }
  if (!run?.planPath) {
    return {
      label: "Plan next",
      variant: "secondary",
      description:
        "Run Goal will generate the /migrate plan and stop before output writes.",
    };
  }
  if (!run?.approved) {
    return {
      label: "Approval needed",
      variant: "outline",
      description:
        "Review and approve the plan before Run Goal can write generated output.",
    };
  }
  if (failedTasks > 0 || failedVerifiers > 0) {
    return {
      label: "Needs follow-up",
      variant: "destructive",
      description:
        "Run Goal will verify again, but the failed task or verifier needs review.",
    };
  }
  if (pending + running > 0) {
    return {
      label: "Ready to advance",
      variant: "default",
      description: `${pending + running} task(s) remain. Run Goal advances a bounded sweep and verifies the result.`,
    };
  }
  if (run?.phase === "complete") {
    return {
      label: "Complete",
      variant: "default",
      description:
        "The /migrate goal is complete and the latest report is available.",
    };
  }
  return {
    label: "Verify",
    variant: "secondary",
    description:
      "All tasks are advanced. Run Goal will refresh deterministic verification.",
  };
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex min-h-[420px] flex-col items-center justify-center text-center">
        <IconRoute className="h-9 w-9 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">Create a /migrate run</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Assessment, plan approval, output generation, artifacts, and
          verification will appear here as an auditable workflow.
        </p>
        <Separator className="my-5 max-w-xs" />
        <p className="max-w-md text-xs text-muted-foreground">
          Deterministic adapters accelerate known sources. When no adapter
          matches, the agent builds an auditable IR from the available evidence
          before output writes are allowed.
        </p>
      </CardContent>
    </Card>
  );
}
