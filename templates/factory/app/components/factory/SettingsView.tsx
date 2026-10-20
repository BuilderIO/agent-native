import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { ActionQueryError } from "@agent-native/dispatch/components";
import { SettingsGroup, SettingsRow } from "@agent-native/toolkit/app/settings";
import { IconLoader2 } from "@tabler/icons-react";
import { useEffect, useReducer } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import { emailReadiness } from "./connection-rows";
import { ConnectionsGroup } from "./ConnectionsGroup";
import { ConnectProviderButton } from "./ConnectProviderButton";
import { DeleteFactoryGroup } from "./DeleteFactoryGroup";
import { ReadinessChip } from "./ReadinessChip";
import { SchedulerGroup } from "./SchedulerGroup";
import {
  INITIAL_SETTINGS_FORM,
  isDirty,
  saveInput,
  settingsFormReducer,
  trimmedForm,
  type FactoryConfig,
} from "./settings-form";

const fieldControlClass = "h-9 w-full sm:w-64";

export function SettingsView({
  factoryId,
  factoryName,
  deletable,
  onDeleted,
}: {
  factoryId: string;
  factoryName: string;
  deletable: boolean;
  onDeleted: () => void;
}) {
  const t = useT();
  const query = useActionQuery<FactoryConfig>("get-triage-config", {
    factoryId,
  });
  const mutation = useActionMutation("save-triage-config");
  const [form, dispatch] = useReducer(
    settingsFormReducer,
    INITIAL_SETTINGS_FORM,
  );

  useEffect(() => {
    if (query.data) dispatch({ type: "loaded", config: query.data });
  }, [query.data]);

  const dirty = isDirty(form);
  const saving = mutation.isPending;

  const saveSettings = async () => {
    if (!form.draft) return;
    const submitted = trimmedForm(form.draft);
    try {
      await mutation.mutateAsync(saveInput(factoryId, submitted));
      dispatch({ type: "saved", submitted });
      toast.success(t("triage.settingsSaved"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("triage.settingsError"),
      );
    }
  };

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
                onClick={() => dispatch({ type: "discard" })}
                disabled={saving}
              >
                {t("triage.discardSettingsChanges")}
              </Button>
              <Button
                type="button"
                onClick={() => void saveSettings()}
                disabled={saving}
              >
                {saving && <IconLoader2 className="animate-spin" />}
                {t("triage.saveSettings")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConnectionsGroup factoryId={factoryId} />

      {form.draft ? (
        <fieldset disabled={saving} className="grid min-w-0 gap-6">
          <SettingsGroup
            variant="soft"
            title={t("settings.factory.alertsTitle")}
          >
            <SettingsRow
              label={t("settings.factory.alertsEnabled")}
              control={
                <Switch
                  aria-label={t("settings.factory.alertsEnabled")}
                  checked={form.draft.failureAlertsEnabled}
                  onCheckedChange={(checked) =>
                    dispatch({
                      type: "edit",
                      patch: { failureAlertsEnabled: checked === true },
                    })
                  }
                />
              }
            />
            {form.draft.failureAlertsEnabled ? (
              <>
                <SettingsRow
                  label={t("factoryRoute.automationFailureAlertEmail")}
                  control={
                    <Input
                      aria-label={t("factoryRoute.automationFailureAlertEmail")}
                      type="email"
                      value={form.draft.failureAlertEmail}
                      onChange={(event) =>
                        dispatch({
                          type: "edit",
                          patch: { failureAlertEmail: event.target.value },
                        })
                      }
                      placeholder={t(
                        "factoryRoute.automationFailureAlertEmailPlaceholder",
                      )}
                      className={fieldControlClass}
                    />
                  }
                />
                <EmailProviderRow readiness={query.data?.emailReadiness} />
              </>
            ) : null}
          </SettingsGroup>
        </fieldset>
      ) : query.isError ? (
        <ActionQueryError
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <FormSkeleton />
      )}

      <SchedulerGroup factoryId={factoryId} />

      {deletable ? (
        <DeleteFactoryGroup
          factoryId={factoryId}
          factoryName={factoryName}
          onDeleted={onDeleted}
        />
      ) : null}
    </div>
  );
}

function EmailProviderRow({
  readiness,
}: {
  readiness: FactoryConfig["emailReadiness"];
}) {
  const t = useT();
  // No reading at all is not a ready provider.
  const state = emailReadiness(readiness?.status ?? "unavailable");
  return (
    <SettingsRow
      label={t("factoryRoute.automationFailureEmailReadiness")}
      control={
        <div className="flex items-center gap-2">
          <ReadinessChip readiness={state.readiness} word={state.word} />
          {state.word !== "connected" ? (
            <ConnectProviderButton
              provider="email"
              connectWith="settings"
              readiness={state.readiness}
            />
          ) : null}
        </div>
      }
    />
  );
}

function FormSkeleton() {
  return (
    <div className="grid gap-6" aria-hidden>
      <Skeleton className="h-[4.25rem] w-full rounded-xl" />
      <div className="grid gap-1 rounded-xl bg-card p-1 shadow-sm">
        <Skeleton className="h-[4.25rem] w-full rounded-lg" />
        <Skeleton className="h-[4.25rem] w-full rounded-lg" />
      </div>
    </div>
  );
}
