import {
  FeatureFlagsEditor,
  useActionMutation,
  useActionQuery,
  useT,
  type FeatureFlagMetadata,
  type SetFeatureFlagInput,
} from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconFlask,
  IconPlayerPlay,
  IconRefresh,
  IconShieldOff,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface FeatureFlag {
  key: string;
  displayName?: string | null;
  description?: string | null;
  defaultValue?: boolean;
  rules?: FeatureFlagMetadata["rules"];
  activeExperimentId?: string;
  activeExperimentName?: string;
}
export interface FlagApp {
  appId?: string;
  appName?: string;
  appOrigin?: string;
  state?: string;
  id?: string;
  name?: string;
  url?: string;
  status?: string;
  reason?: string;
  flags?: FeatureFlag[];
}
export interface FlagDirectory {
  directoryStatus?: string;
  apps?: FlagApp[];
}
export interface Experiment {
  id: string;
  name: string;
  hypothesis?: string;
  appId: string;
  appName?: string;
  flagKey: string;
  primaryEventName: string;
  status: string;
  treatmentPercentage?: number;
  startedAt?: string;
  endedAt?: string;
  interruptionReason?: string;
  updatedAt?: string;
  results?: Record<string, unknown>;
}

function asDirectory(value: unknown): FlagDirectory {
  return value && typeof value === "object" ? (value as FlagDirectory) : {};
}
function asExperiments(value: unknown): Experiment[] {
  if (Array.isArray(value)) return value as Experiment[];
  return value &&
    typeof value === "object" &&
    Array.isArray((value as { experiments?: unknown }).experiments)
    ? (value as { experiments: Experiment[] }).experiments
    : [];
}
function isReady(app: FlagApp) {
  return app.state === "ready" || app.status === "ready";
}
function statusLabel(app: FlagApp) {
  return app.state || app.status || "unknown-legacy";
}
function appId(app: FlagApp) {
  return app.appId || app.id || "";
}
function appName(app: FlagApp) {
  return app.appName || app.name || appId(app);
}
function asExperiment(value: unknown): Experiment | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as {
    experiment?: Experiment;
    results?: Record<string, unknown>;
  };
  return result.experiment
    ? {
        ...result.experiment,
        results: result.results ?? result.experiment.results,
      }
    : (value as Experiment);
}

export function qualifyFleetMutation(
  appId: string,
  input: SetFeatureFlagInput,
) {
  return { appId, ...input };
}

export function experimentResultRows(results: Record<string, unknown>) {
  const control = (results.control || {}) as Record<string, unknown>;
  const treatment = (results.treatment || {}) as Record<string, unknown>;
  return {
    control,
    treatment,
    lift: results.lift,
    sampleSize: results.sampleSize,
  };
}

export function FeatureFlagsFleetPanel({
  selectedFlag,
}: {
  selectedFlag: string | null;
}) {
  const t = useT();
  const client = useQueryClient();
  const flags = useActionQuery<unknown>(
    "list-workspace-feature-flags",
    undefined,
    { retry: false },
  );
  const experiments = useActionQuery<unknown>(
    "list-product-experiments",
    undefined,
    { retry: false },
  );
  const activeExperiments = asExperiments(experiments.data).filter((item) =>
    ["running", "paused", "interrupted"].includes(item.status),
  );
  const mutation = useActionMutation<
    unknown,
    { appId: string } & SetFeatureFlagInput
  >("set-workspace-feature-flag", {
    onMutate: async (input) => {
      await client.cancelQueries({
        queryKey: ["action", "list-workspace-feature-flags"],
      });
      const key = ["action", "list-workspace-feature-flags", undefined];
      const previous = client.getQueryData(key);
      client.setQueryData(key, (old: unknown) => {
        const data = asDirectory(old);
        return {
          ...data,
          apps: data.apps?.map((app) =>
            appId(app) !== input.appId
              ? app
              : {
                  ...app,
                  flags: app.flags?.map((flag) =>
                    flag.key !== input.key
                      ? flag
                      : {
                          ...flag,
                          rules:
                            input.operation === "replace-rules" && input.rules
                              ? input.rules
                              : input.operation === "off"
                                ? {
                                    ...flag.rules!,
                                    mode: "off",
                                    emails: [],
                                    orgIds: [],
                                    percentage: 0,
                                  }
                                : flag.rules,
                        },
                  ),
                },
          ),
        };
      });
      return { previous, key };
    },
    onError: (_error, _input, context: any) => {
      if (context) client.setQueryData(context.key, context.previous);
    },
    onSettled: () =>
      void client.invalidateQueries({
        queryKey: ["action", "list-workspace-feature-flags"],
      }),
  });
  const directory = asDirectory(flags.data);
  const apps = directory.apps ?? [];
  if (flags.isLoading) return <PanelLoading />;
  if (flags.error || directory.directoryStatus === "unavailable")
    return (
      <StatusState
        title={t("agents.flagsUnavailable")}
        detail={flags.error?.message || t("agents.flagsUnreachable")}
        onRetry={() => void flags.refetch()}
      />
    );
  if (apps.length === 0)
    return (
      <StatusState
        title={t("agents.flagsEmpty")}
        detail={t("agents.flagsEmptyDetail")}
        onRetry={() => void flags.refetch()}
      />
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("agents.featureFlags")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("agents.featureFlagsDescription")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void flags.refetch()}
        >
          <IconRefresh className="me-2 size-4" />
          {t("sidebar.retry")}
        </Button>
      </div>
      {apps.map((app) => (
        <section key={appId(app)} className="overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
            <div>
              <h3 className="text-sm font-medium">{appName(app)}</h3>
              {app.reason ? (
                <p className="text-xs text-muted-foreground">{app.reason}</p>
              ) : null}
              {activeExperiments
                .filter((experiment) => experiment.appId === appId(app))
                .map((experiment) => (
                  <Link
                    key={experiment.id}
                    className="mt-1 block text-xs text-primary underline-offset-4 hover:underline"
                    to={`/agents?view=experiments&experiment=${encodeURIComponent(experiment.id)}`}
                  >
                    {experiment.name} · {experiment.flagKey}
                  </Link>
                ))}
            </div>
            <Badge variant={isReady(app) ? "secondary" : "outline"}>
              {statusLabel(app)}
            </Badge>
          </div>
          {isReady(app) ? (
            <div className="p-4">
              <FeatureFlagsEditor
                flags={(app.flags ?? []).filter(
                  (flag): flag is FeatureFlagMetadata =>
                    !!flag.rules && typeof flag.defaultValue === "boolean",
                )}
                isPending={mutation.isPending}
                error={mutation.error}
                disabledKeys={activeExperiments
                  .filter(
                    (experiment) =>
                      experiment.appId === appId(app) &&
                      experiment.status === "running",
                  )
                  .map((experiment) => experiment.flagKey)}
                onMutate={(input) =>
                  mutation.mutate(qualifyFleetMutation(appId(app), input))
                }
              />
            </div>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              {statusLabel(app) === "no-definitions"
                ? t("agents.noFlagDefinitions")
                : t("agents.flagsNotReady", { status: statusLabel(app) })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export function ProductExperimentsPanel({
  selectedExperiment,
}: {
  selectedExperiment: string | null;
}) {
  const t = useT();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState<{
    experiment: Experiment;
    operation: string;
  } | null>(null);
  const list = useActionQuery<unknown>("list-product-experiments", undefined, {
    retry: false,
  });
  const fleet = useActionQuery<unknown>(
    "list-workspace-feature-flags",
    undefined,
    { retry: false },
  );
  const experiments = asExperiments(list.data);
  const selected =
    experiments.find((experiment) => experiment.id === selectedExperiment) ??
    null;
  const detail = useActionQuery<unknown>(
    "get-product-experiment",
    selected ? { id: selected.id } : undefined,
    { enabled: !!selected, retry: false },
  );
  const manage = useActionMutation<unknown, Record<string, unknown>>(
    "manage-product-experiment",
    { onSuccess: () => void Promise.all([list.refetch(), detail.refetch()]) },
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            {t("agents.productExperiments")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("agents.productExperimentsDescription")}
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <IconFlask className="me-2 size-4" />
          {t("agents.createExperiment")}
        </Button>
      </div>
      {list.isLoading ? (
        <PanelLoading />
      ) : list.error ? (
        <StatusState
          title={t("agents.experimentsUnavailable")}
          detail={list.error.message}
          onRetry={() => void list.refetch()}
        />
      ) : experiments.length === 0 ? (
        <StatusState
          title={t("agents.experimentsEmpty")}
          detail={t("agents.experimentsEmptyDetail")}
          onRetry={() => setCreateOpen(true)}
          actionLabel={t("agents.createExperiment")}
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
          <div className="overflow-hidden rounded-lg border">
            {experiments.map((experiment) => (
              <Link
                key={experiment.id}
                to={`/agents?view=experiments&experiment=${encodeURIComponent(experiment.id)}`}
                className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-0 hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {experiment.name}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {experiment.appName || experiment.appId} ·{" "}
                    {experiment.flagKey} · {experiment.primaryEventName}
                  </p>
                </div>
                <Badge variant="outline">{experiment.status}</Badge>
              </Link>
            ))}
          </div>
          <ExperimentDetail
            experiment={asExperiment(detail.data) || selected}
            onManage={(operation) =>
              setConfirm({
                experiment: selected || asExperiment(detail.data)!,
                operation,
              })
            }
          />
        </div>
      )}
      <CreateExperimentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        apps={(asDirectory(fleet.data).apps || []).filter(isReady)}
        onCreate={async (input) => {
          await manage.mutateAsync({ operation: "create", experiment: input });
          setCreateOpen(false);
        }}
        pending={manage.isPending}
      />
      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.operation === "emergency-off"
                ? t("agents.emergencyOffTitle")
                : t("agents.changeExperimentTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("agents.changeExperimentDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirm &&
                manage.mutate({
                  operation: confirm.operation,
                  id: confirm.experiment.id,
                })
              }
            >
              {t("agents.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ExperimentDetail({
  experiment,
  onManage,
}: {
  experiment: Experiment | null | undefined;
  onManage: (operation: string) => void;
}) {
  const t = useT();
  if (!experiment)
    return (
      <div className="rounded-lg border p-5 text-sm text-muted-foreground">
        {t("agents.selectExperiment")}
      </div>
    );
  const results = experiment.results || {};
  const { control, treatment, lift, sampleSize } =
    experimentResultRows(results);
  const metrics = [
    [
      t("agents.controlSample"),
      control.exposed,
      control.conversions,
      control.rate,
    ],
    [
      t("agents.treatmentSample"),
      treatment.exposed,
      treatment.conversions,
      treatment.rate,
    ],
    [t("agents.lift"), lift, sampleSize, null],
  ] as const;
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{experiment.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {experiment.hypothesis || t("agents.noHypothesis")}
          </p>
        </div>
        <Badge>{experiment.status}</Badge>
      </div>
      <Link
        className="mt-3 inline-block text-xs text-primary underline-offset-4 hover:underline"
        to={`/agents?view=flags&flag=${encodeURIComponent(experiment.flagKey)}`}
      >
        {t("agents.openFlag")}
      </Link>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {metrics.map(([label, exposed, conversions, rate]) => (
          <div key={label} className="rounded-md bg-muted/50 p-2">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="text-sm font-medium">{String(exposed ?? "—")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {conversions !== null && conversions !== undefined
                ? `${t("agents.conversions")}: ${String(conversions)} · ${t("agents.conversionRate")}: ${String(rate ?? "—")}`
                : `${t("agents.exposed")}: ${String(conversions ?? "—")}`}
            </p>
          </div>
        ))}
      </div>
      {results.validityWarning ||
      results.truncated ||
      results.coverage === "partial" ? (
        <Alert className="mt-4">
          <IconAlertTriangle className="size-4" />
          <AlertTitle>{t("agents.resultsWarning")}</AlertTitle>
          <AlertDescription>
            {String(
              results.validityWarning || results.truncated || results.coverage,
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {["draft", "paused"].includes(experiment.status) ? (
          <Button size="sm" onClick={() => onManage("start")}>
            <IconPlayerPlay className="me-2 size-4" />
            {t("agents.start")}
          </Button>
        ) : null}
        {experiment.status === "running" ? (
          <Button size="sm" variant="outline" onClick={() => onManage("pause")}>
            {t("agents.pause")}
          </Button>
        ) : null}
        {["running", "paused"].includes(experiment.status) ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onManage("complete")}
          >
            {t("agents.complete")}
          </Button>
        ) : null}
        {experiment.status !== "completed" ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onManage("emergency-off")}
          >
            <IconShieldOff className="me-2 size-4" />
            {t("agents.emergencyOff")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
function CreateExperimentDialog({
  open,
  onOpenChange,
  onCreate,
  pending,
  apps,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: Record<string, unknown>) => Promise<void>;
  pending: boolean;
  apps: FlagApp[];
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    hypothesis: "",
    appId: "",
    flagKey: "",
    treatmentPercentage: "50",
    primaryEventName: "",
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await onCreate({
        ...form,
        treatmentPercentage: Number(form.treatmentPercentage),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("agents.createExperiment")}</DialogTitle>
          <DialogDescription>
            {t("agents.createExperimentDescription")}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          {(["name", "primaryEventName"] as const).map((field) => (
            <div className="grid gap-1.5" key={field}>
              <Label htmlFor={`experiment-${field}`}>
                {t(`agents.${field}`)}
              </Label>
              <Input
                id={`experiment-${field}`}
                required
                value={form[field]}
                onChange={(event) =>
                  setForm({ ...form, [field]: event.target.value })
                }
              />
            </div>
          ))}
          <div className="grid gap-1.5">
            <Label>{t("agents.appId")}</Label>
            <Select
              value={form.appId}
              onValueChange={(appId) =>
                setForm({ ...form, appId, flagKey: "" })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("agents.selectApp")} />
              </SelectTrigger>
              <SelectContent>
                {apps.map((app) => (
                  <SelectItem key={appId(app)} value={appId(app)}>
                    {appName(app)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="grid gap-1.5">
            <Label>{t("agents.flagKey")}</Label>
            <Select
              value={form.flagKey}
              onValueChange={(flagKey) => setForm({ ...form, flagKey })}
              disabled={!form.appId}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("agents.selectFlag")} />
              </SelectTrigger>
              <SelectContent>
                {apps
                  .find((app) => appId(app) === form.appId)
                  ?.flags?.map((flag) => (
                    <SelectItem key={flag.key} value={flag.key}>
                      {flag.displayName || flag.key}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="experiment-hypothesis">
              {t("agents.hypothesis")}
            </Label>
            <Textarea
              id="experiment-hypothesis"
              value={form.hypothesis}
              onChange={(event) =>
                setForm({ ...form, hypothesis: event.target.value })
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="experiment-percentage">
              {t("agents.treatmentPercentage")}
            </Label>
            <Input
              id="experiment-percentage"
              type="number"
              min="1"
              max="99"
              required
              value={form.treatmentPercentage}
              onChange={(event) =>
                setForm({ ...form, treatmentPercentage: event.target.value })
              }
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("sidebar.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("agents.createExperiment")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function PanelLoading() {
  const t = useT();
  return (
    <div className="flex min-h-52 items-center justify-center rounded-lg border text-sm text-muted-foreground">
      {t("agents.loading")}
    </div>
  );
}
function StatusState({
  title,
  detail,
  onRetry,
  actionLabel,
}: {
  title: string;
  detail: string;
  onRetry: () => void;
  actionLabel?: string;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border p-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      <Button className="mt-4" size="sm" variant="outline" onClick={onRetry}>
        {actionLabel || t("sidebar.retry")}
      </Button>
    </div>
  );
}
