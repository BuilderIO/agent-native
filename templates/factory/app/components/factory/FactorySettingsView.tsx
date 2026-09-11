import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import { ActionQueryError } from "@agent-native/dispatch/components";
import { IconLoader2, IconTrash } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type TriageConfig = {
  builderSlackUserId?: string | null;
  automationFailureAlertsEnabled?: boolean;
  automationFailureAlertEmail?: string | null;
  emailReadiness?: {
    status: "ready" | "not-configured" | "misconfigured" | "unavailable";
    provider: string;
  };
};

type TriageFormState = {
  builderSlackUserId: string;
  automationFailureAlertsEnabled: boolean;
  automationFailureAlertEmail: string;
};

function formStateFromConfig(data: TriageConfig): TriageFormState {
  return {
    builderSlackUserId: data.builderSlackUserId ?? "",
    automationFailureAlertsEnabled: data.automationFailureAlertsEnabled ?? true,
    automationFailureAlertEmail: data.automationFailureAlertEmail ?? "",
  };
}

function isSameForm(a: TriageFormState, b: TriageFormState) {
  return (Object.keys(a) as (keyof TriageFormState)[]).every(
    (key) => a[key] === b[key],
  );
}

function trimmedForm(form: TriageFormState): TriageFormState {
  return {
    ...form,
    builderSlackUserId: form.builderSlackUserId.trim(),
    automationFailureAlertEmail: form.automationFailureAlertEmail.trim(),
  };
}

type FactoryAutomationHealth = {
  status: "healthy" | "stale" | "error" | "no-data";
  lastCheckedAt?: number | null;
  lastDispatchedAt?: number | null;
  lastError?: string | null;
  runtime?: string | null;
};

function formatAutomationDate(value: string | number | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function FactorySettingsView({
  factoryId = "product-feedback",
  factoryName,
  onDeleted,
}: {
  factoryId?: string;
  factoryName: string;
  onDeleted: () => void;
}) {
  const t = useT();
  const [builderSlackUserId, setBuilderSlackUserId] = useState("");
  const [automationFailureAlertsEnabled, setAutomationFailureAlertsEnabled] =
    useState(true);
  const [automationFailureAlertEmail, setAutomationFailureAlertEmail] =
    useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const query = useActionQuery("get-triage-config", { factoryId });
  const schedulerHealthQuery = useActionQuery<FactoryAutomationHealth>(
    "get-factory-automation-health",
    {},
    { refetchInterval: 60_000 },
  );
  const [baseline, setBaseline] = useState<TriageFormState | null>(null);
  const hydratedRef = useRef(false);
  const dirtyRef = useRef(false);
  const mutation = useActionMutation("save-triage-config");
  const deleteMutation = useActionMutation("delete-factory", {
    method: "DELETE",
  });

  const applyForm = useCallback((state: TriageFormState) => {
    setBuilderSlackUserId(state.builderSlackUserId);
    setAutomationFailureAlertsEnabled(state.automationFailureAlertsEnabled);
    setAutomationFailureAlertEmail(state.automationFailureAlertEmail);
  }, []);

  useEffect(() => {
    hydratedRef.current = false;
    dirtyRef.current = false;
    setBaseline(null);
  }, [factoryId]);

  useEffect(() => {
    const data = query.data as TriageConfig | undefined;
    if (!data) return;
    // A background refetch must never overwrite edits the user has not saved
    // yet: the sticky bar is the only signal those edits still exist.
    if (hydratedRef.current && dirtyRef.current) return;
    const next = formStateFromConfig(data);
    applyForm(next);
    setBaseline(next);
    hydratedRef.current = true;
  }, [applyForm, query.data]);

  const configLoaded = Boolean(query.data) && !query.isError;

  const currentForm: TriageFormState = {
    builderSlackUserId,
    automationFailureAlertsEnabled,
    automationFailureAlertEmail,
  };
  const dirty = baseline !== null && !isSameForm(baseline, currentForm);
  const saving = mutation.isPending;
  const latestFormRef = useRef(currentForm);
  latestFormRef.current = currentForm;

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const saveSettings = async () => {
    if (!configLoaded) {
      toast.error(t("triage.settingsError"));
      return;
    }
    const submitted = trimmedForm(currentForm);
    try {
      await mutation.mutateAsync({
        factoryId,
        builderSlackUserId: submitted.builderSlackUserId,
        automationFailureAlertsEnabled:
          submitted.automationFailureAlertsEnabled,
        automationFailureAlertEmail: submitted.automationFailureAlertEmail,
      });
      if (isSameForm(trimmedForm(latestFormRef.current), submitted)) {
        applyForm(submitted);
      }
      setBaseline(submitted);
      toast.success(t("triage.settingsSaved"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("triage.settingsError"),
      );
    }
  };

  const deleteFactory = async () => {
    try {
      await deleteMutation.mutateAsync({
        factoryId,
        confirmName: deleteConfirmation,
      });
      toast.success(t("factoryRoute.factoryDeleted"));
      setDeleteDialogOpen(false);
      onDeleted();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("factoryRoute.factoryDeleteFailed"),
      );
    }
  };

  if (query.isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 lg:p-6">
        <FactorySettingsSkeleton t={t} />
      </div>
    );
  }

  if (!configLoaded) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 lg:p-6">
        <ActionQueryError
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const fieldControlClass = "h-9 w-full sm:w-64";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 lg:p-6">
      {dirty ? (
        <div className="sticky top-0 z-10 -mt-4 bg-background pt-4 lg:-mt-6 lg:pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 shadow-sm">
            <span className="text-sm font-medium text-foreground">
              {t("triage.unsavedSettings")}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => baseline && applyForm(baseline)}
                disabled={saving}
              >
                {t("triage.discardSettingsChanges")}
              </Button>
              <Button
                type="button"
                onClick={() => void saveSettings()}
                disabled={saving || !configLoaded}
              >
                {mutation.isPending && <IconLoader2 className="animate-spin" />}
                {t("triage.saveSettings")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <SettingsGroup variant="soft">
        <SettingsRow
          label={t("factoryRoute.workspaceIntegrations")}
          description={t("settings.workspaceDescription")}
          control={
            <Button asChild type="button" variant="outline">
              <Link to={buildSettingsRoute("integrations")}>Manage</Link>
            </Button>
          }
        />
        <SettingsRow
          label={t("factoryRoute.agentAccess")}
          description={t("settings.agentDescription")}
          control={
            <Button asChild type="button" variant="outline">
              <Link to={buildSettingsRoute("agent")}>Manage</Link>
            </Button>
          }
        />
      </SettingsGroup>

      <fieldset disabled={saving} className="contents">
        <SettingsGroup variant="soft">
          <SettingsRow
            label={t("triage.builderSlackUserId")}
            description={t("factoryRoute.builderSlackUserIdDescription")}
            control={
              <Input
                aria-label={t("triage.builderSlackUserId")}
                value={builderSlackUserId}
                onChange={(event) => setBuilderSlackUserId(event.target.value)}
                placeholder={t("triage.builderSlackUserIdPlaceholder")}
                className={fieldControlClass}
              />
            }
          />
        </SettingsGroup>

        <SettingsGroup variant="soft">
          <SettingsRow
            label={t("factoryRoute.automationFailureAlertsTitle")}
            description={t("factoryRoute.automationFailureAlertsDescription")}
            control={
              <Switch
                aria-label={t("factoryRoute.automationFailureAlertsEnabled")}
                checked={automationFailureAlertsEnabled}
                onCheckedChange={(checked) =>
                  setAutomationFailureAlertsEnabled(checked === true)
                }
              />
            }
          />
          <SettingsRow
            label={t("factoryRoute.automationFailureAlertEmail")}
            description={t(
              "factoryRoute.automationFailureAlertEmailPlaceholder",
            )}
            control={
              <Input
                aria-label={t("factoryRoute.automationFailureAlertEmail")}
                type="email"
                value={automationFailureAlertEmail}
                onChange={(event) =>
                  setAutomationFailureAlertEmail(event.target.value)
                }
                placeholder={t(
                  "factoryRoute.automationFailureAlertEmailPlaceholder",
                )}
                className={fieldControlClass}
              />
            }
          />
          <SettingsRow
            label={t("factoryRoute.automationFailureEmailReadiness")}
            description={t("factoryRoute.automationEmailReadinessHint")}
            control={
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {(query.data as TriageConfig | undefined)?.emailReadiness
                  ?.status ?? "unknown"}
              </span>
            }
          />
        </SettingsGroup>
      </fieldset>

      <SchedulerHealthStatus
        health={schedulerHealthQuery.data}
        isError={schedulerHealthQuery.isError}
        error={schedulerHealthQuery.error}
        t={t}
      />

      {factoryId !== "product-feedback" ? (
        <SettingsGroup title={t("factoryRoute.dangerZone")}>
          <SettingsRow
            label={t("factoryRoute.deleteFactory")}
            description={t("factoryRoute.deleteFactoryDescription")}
            control={
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={deleteMutation.isPending}
              >
                <IconTrash />
                {t("factoryRoute.deleteFactory")}
              </Button>
            }
          />
        </SettingsGroup>
      ) : null}

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (deleteMutation.isPending) return;
          setDeleteDialogOpen(open);
          if (!open) setDeleteConfirmation("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("factoryRoute.deleteFactoryTitle", { name: factoryName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("factoryRoute.deleteFactoryWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <label
              htmlFor="delete-factory-confirmation"
              className="text-sm font-medium"
            >
              {t("factoryRoute.deleteFactoryConfirmation", {
                name: factoryName,
              })}
            </label>
            <Input
              id="delete-factory-confirmation"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {t("factoryRoute.deleteFactoryCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={
                deleteConfirmation !== factoryName || deleteMutation.isPending
              }
              onClick={(event) => {
                event.preventDefault();
                void deleteFactory();
              }}
            >
              {deleteMutation.isPending ? (
                <IconLoader2 className="animate-spin" />
              ) : (
                <IconTrash />
              )}
              {t("factoryRoute.deleteFactoryConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FactorySettingsSkeleton({ t }: { t: ReturnType<typeof useT> }) {
  return (
    <div className="space-y-6" aria-label={t("triage.loading")}>
      {[2, 1, 3, 3].map((rowCount, index) => (
        <div key={index} className="grid gap-2">
          <div className="grid gap-2">
            {Array.from({ length: rowCount }).map((_, rowIndex) => (
              <div
                key={rowIndex}
                className="flex min-h-20 items-center justify-between gap-4 rounded-xl bg-card px-5 py-4 shadow-sm sm:px-6"
              >
                <div className="h-3.5 w-36 animate-pulse rounded bg-muted" />
                <div className="h-9 w-24 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SchedulerHealthStatus({
  health,
  isError,
  error,
  t,
}: {
  health?: FactoryAutomationHealth;
  isError: boolean;
  error: unknown;
  t: ReturnType<typeof useT>;
}) {
  const healthLabel = isError
    ? t("factoryRoute.automationHealthError")
    : health
      ? {
          healthy: t("factoryRoute.automationHealthHealthy"),
          stale: t("factoryRoute.automationHealthStale"),
          error: t("factoryRoute.automationHealthError"),
          "no-data": t("factoryRoute.automationHealthNoData"),
        }[health.status]
      : t("factoryRoute.automationHealthNoData");
  const errorDetail = isError
    ? `${t("factoryRoute.automationDiagnosticsLoadError")} ${error instanceof Error ? error.message : String(error)}`
    : health?.lastError || null;

  return (
    <SettingsGroup
      variant="soft"
      title={t("factoryRoute.automationHealthTitle")}
      description={t("factoryRoute.automationHealthDescription")}
    >
      <SettingsRow
        label={t("factoryRoute.automationHealthStatus")}
        control={
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
            {healthLabel}
          </span>
        }
      />
      <SettingsRow
        label={t("factoryRoute.automationLastCheck")}
        control={
          <span className="text-sm text-muted-foreground">
            {formatAutomationDate(health?.lastCheckedAt)}
          </span>
        }
      />
      <SettingsRow
        label={t("factoryRoute.automationLastDispatch")}
        control={
          <span className="text-sm text-muted-foreground">
            {formatAutomationDate(health?.lastDispatchedAt)}
          </span>
        }
      />
      {errorDetail ? (
        <SettingsRow
          label={t("factoryRoute.automationHealthErrorDetail")}
          control={
            <span className="max-w-sm text-end text-sm text-muted-foreground">
              {errorDetail}
            </span>
          }
        />
      ) : null}
    </SettingsGroup>
  );
}
