import { useT } from "@agent-native/core/client";
import { Label } from "@agent-native/toolkit/ui/label";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { Switch } from "@agent-native/toolkit/ui/switch";
import { IconAlertTriangle } from "@tabler/icons-react";
import { toast } from "sonner";

import {
  useContentHookRuntimeControls,
  useManageContentHookRuntimeControl,
} from "@/hooks/use-content-database";

export function DatabaseHookIncidentControls({
  databaseId,
  canManage,
  hasExecutionIncident = false,
}: {
  databaseId: string;
  canManage: boolean;
  hasExecutionIncident?: boolean;
}) {
  const t = useT();
  const controls = useContentHookRuntimeControls(databaseId);
  const manage = useManageContentHookRuntimeControl(databaseId);
  const data = controls.data;
  const needsAttention =
    hasExecutionIncident ||
    data?.effective.evaluatorPaused ||
    data?.effective.effectsPaused;

  const update = async (
    scope: "global" | "database",
    patch: { evaluatorPaused?: boolean; effectsPaused?: boolean },
  ) => {
    if (!data) return;
    try {
      await manage.mutateAsync({
        databaseId,
        scope,
        evaluatorPaused: patch.evaluatorPaused ?? data[scope].evaluatorPaused,
        effectsPaused: patch.effectsPaused ?? data[scope].effectsPaused,
      });
    } catch (error) {
      toast.error(t("database.hookPauseSaveFailed"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    }
  };

  if (!controls.isLoading && !needsAttention) return null;

  return (
    <details className="group border-b border-border pb-4">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-md px-1 py-2 hover:bg-muted/60">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <IconAlertTriangle className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {t("database.hookIncidentControls")}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {data?.effective.evaluatorPaused || data?.effective.effectsPaused
              ? t("database.hookProcessingPaused")
              : t("database.executionFailed")}
          </span>
        </span>
      </summary>
      <div className="grid gap-4 px-1 pt-3">
        <p className="text-xs leading-5 text-muted-foreground">
          {t("database.hookIncidentControlsDescription")}
        </p>
        {controls.isLoading ? (
          <div className="flex justify-center py-3">
            <Spinner className="size-4" />
          </div>
        ) : data ? (
          (["database", "global"] as const).map((scope) => {
            const editable =
              canManage && (scope === "database" || data.canManageGlobal);
            return (
              <div key={scope} className="grid gap-2">
                <h4 className="text-xs font-medium">
                  {t(
                    scope === "database"
                      ? "database.thisDatabase"
                      : "database.allContentDatabases",
                  )}
                </h4>
                <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
                  <Label htmlFor={`${scope}-evaluation-pause`}>
                    {t("database.pauseHookEvaluation")}
                  </Label>
                  <Switch
                    id={`${scope}-evaluation-pause`}
                    checked={data[scope].evaluatorPaused}
                    disabled={!editable || manage.isPending}
                    onCheckedChange={(evaluatorPaused) =>
                      void update(scope, { evaluatorPaused })
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
                  <Label htmlFor={`${scope}-effect-pause`}>
                    {t("database.pauseHookEffects")}
                  </Label>
                  <Switch
                    id={`${scope}-effect-pause`}
                    checked={data[scope].effectsPaused}
                    disabled={!editable || manage.isPending}
                    onCheckedChange={(effectsPaused) =>
                      void update(scope, { effectsPaused })
                    }
                  />
                </div>
              </div>
            );
          })
        ) : null}
        <p className="text-xs leading-4 text-muted-foreground">
          {t("database.pausedHookEventsNotReplayed")}
        </p>
      </div>
    </details>
  );
}
