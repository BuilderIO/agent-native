import { useEffect, useMemo, useState } from "react";
import {
  IconCheck,
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
  outputRoot: string;
  target: string;
  phase: string;
  approved: boolean;
  taskCount: number;
  passedTaskCount: number;
  failedTaskCount: number;
  updatedAt: string;
};

export function meta() {
  return [
    { title: "Migration Workbench" },
    {
      name: "description",
      content:
        "Migrate existing Next.js apps to agent-native with assessment, approval, and deterministic verification.",
    },
  ];
}

export default function MigrationWorkbenchPage() {
  useSetPageTitle("Migration Workbench");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [name, setName] = useState("Next.js migration");
  const [sourceRoot, setSourceRoot] = useState("");
  const [outputRoot, setOutputRoot] = useState("../migrated-app");
  const runsQuery = useActionQuery("list-migration-runs", {});
  const seedQuery = useActionQuery("get-migration-seed", {});
  const runs = ((runsQuery.data as { runs?: RunSummary[] } | undefined)?.runs ??
    []) as RunSummary[];
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0],
    [runs, selectedRunId],
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
  const runTask = useActionMutation("run-migration-task");
  const verify = useActionMutation("verify-migration");

  useEffect(() => {
    const seed = (seedQuery.data as { seed?: any } | undefined)?.seed;
    if (!seed || sourceRoot) return;
    if (typeof seed.sourceRoot === "string") setSourceRoot(seed.sourceRoot);
    if (typeof seed.outputRoot === "string") setOutputRoot(seed.outputRoot);
    if (typeof seed.name === "string") setName(seed.name);
  }, [seedQuery.data, sourceRoot]);

  async function create() {
    if (!sourceRoot.trim()) return;
    const result = (await createRun.mutateAsync({
      name,
      sourceRoot,
      outputRoot,
      target: "agent-native",
    } as any)) as { run?: { id: string } };
    if (result.run?.id) setSelectedRunId(result.run.id);
    setSourceRoot("");
  }

  const detail = runQuery.data as
    | {
        run?: any;
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
  const tasks = detail?.tasks ?? [];
  const progress =
    tasks.length > 0
      ? Math.round(
          (tasks.filter((task) => task.status === "passed").length /
            tasks.length) *
            100,
        )
      : 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6 lg:px-8">
      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New run</CardTitle>
              <CardDescription>
                Point at an existing Next.js app. The Workbench reads source and
                writes generated output somewhere else.
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
                placeholder="/absolute/path/to/next-app"
                className="min-h-20"
              />
              <Input
                value={outputRoot}
                onChange={(event) => setOutputRoot(event.target.value)}
                placeholder="../migrated-app"
              />
              <Button
                onClick={create}
                disabled={!sourceRoot.trim() || createRun.isPending}
                className="w-full"
              >
                <IconRoute className="h-4 w-4" />
                Create migration run
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Runs</CardTitle>
              <CardDescription>
                Resumable local migration audits.
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
                  No migration runs yet.
                </p>
              ) : (
                runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
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
                      {run.sourceRoot}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{run.taskCount} tasks</span>
                      <span>{run.passedTaskCount} passed</span>
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
                      {selectedRun.sourceRoot}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        assess.mutate({ id: selectedRun.id } as any)
                      }
                      disabled={assess.isPending}
                    >
                      <IconFileText className="h-4 w-4" />
                      Assess
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => plan.mutate({ id: selectedRun.id } as any)}
                      disabled={plan.isPending}
                    >
                      <IconListCheck className="h-4 w-4" />
                      Plan
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        approve.mutate({ id: selectedRun.id } as any)
                      }
                      disabled={approve.isPending || selectedRun.approved}
                    >
                      <IconCheck className="h-4 w-4" />
                      Approve
                    </Button>
                    <Button
                      onClick={() =>
                        runTask.mutate({ id: selectedRun.id } as any)
                      }
                      disabled={runTask.isPending || !selectedRun.approved}
                    >
                      <IconPlayerPlay className="h-4 w-4" />
                      Run task
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        verify.mutate({ id: selectedRun.id } as any)
                      }
                      disabled={verify.isPending}
                    >
                      <IconShieldCheck className="h-4 w-4" />
                      Verify
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 md:grid-cols-3">
                  <Metric
                    label="Phase"
                    value={detail?.run?.phase ?? selectedRun.phase}
                  />
                  <Metric label="Target" value={selectedRun.target} />
                  <Metric label="Output" value={selectedRun.outputRoot} />
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
                            <Badge variant="outline">{task.status}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {task.summary}
                          </p>
                        </div>
                      ))
                    )}
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
        <h2 className="mt-4 text-lg font-semibold">Create a migration run</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Assessment, plan approval, output generation, and verification will
          appear here as an auditable workflow.
        </p>
        <Separator className="my-5 max-w-xs" />
        <p className="max-w-md text-xs text-muted-foreground">
          V1 supports Next.js to standalone agent-native. Builder Publish and
          AEM modes are designed into the adapter contracts for the enterprise
          path.
        </p>
      </CardContent>
    </Card>
  );
}
