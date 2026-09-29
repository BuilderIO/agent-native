import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import { useState } from "react";
import { toast } from "sonner";

import { ActionQueryError } from "./action-query-error";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Switch } from "./ui/switch";

interface BuiltinApp {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
}

interface BuiltinAppsListing {
  mode: "all" | "none" | "selected";
  canManage: boolean;
  apps: BuiltinApp[];
}

export function BuiltinAppsSettingsGroup() {
  const t = useT();
  const query = useActionQuery<BuiltinAppsListing>("list-builtin-agents", {});
  const [optimisticIds, setOptimisticIds] = useState<string[] | null>(null);
  const save = useActionMutation("set-builtin-agents-enabled", {
    onSuccess: () => {
      setOptimisticIds(null);
      toast.success(t("dispatch.pages.builtinAppsUpdated"));
    },
    onError: (error) => {
      setOptimisticIds(null);
      toast.error(error.message);
    },
  });

  const title = t("dispatch.pages.builtinAppsTitle");

  if (query.isLoading) {
    return (
      <SettingsGroup id="builtin-apps" title={title}>
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-4 px-5 py-4 sm:px-6">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
        ))}
      </SettingsGroup>
    );
  }
  if (query.isError) {
    return (
      <SettingsGroup id="builtin-apps" title={title}>
        <div className="p-4">
          <ActionQueryError
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        </div>
      </SettingsGroup>
    );
  }

  const listing = query.data;
  if (!listing || listing.mode === "none" || listing.apps.length === 0) {
    return null;
  }

  const enabledIds =
    optimisticIds ??
    listing.apps.filter((app) => app.enabled).map((app) => app.id);
  const enabled = new Set(enabledIds);
  const disabled = !listing.canManage || save.isPending;
  const adminOnly = listing.canManage
    ? undefined
    : t("dispatch.pages.builtinAppsAdminOnly");

  function persist(next: string[]) {
    setOptimisticIds(next);
    save.mutate({ enabledIds: next });
  }

  return (
    <SettingsGroup id="builtin-apps" title={title}>
      <div
        className="flex justify-end gap-2 px-5 py-2 sm:px-6"
        title={adminOnly}
      >
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || enabled.size === listing.apps.length}
          onClick={() => persist(listing.apps.map((app) => app.id))}
        >
          {t("dispatch.pages.builtinAppsEnableAll")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || enabled.size === 0}
          onClick={() => persist([])}
        >
          {t("dispatch.pages.builtinAppsDisableAll")}
        </Button>
      </div>
      {listing.apps.map((app) => (
        <SettingsRow
          key={app.id}
          id={`builtin-app-${app.id}`}
          label={app.name}
          description={app.description || undefined}
          control={
            <span title={adminOnly}>
              <Switch
                checked={enabled.has(app.id)}
                disabled={disabled}
                aria-label={t("dispatch.pages.builtinAppToggle", {
                  name: app.name,
                })}
                onCheckedChange={(checked) =>
                  persist(
                    checked
                      ? [...enabledIds, app.id]
                      : enabledIds.filter((id) => id !== app.id),
                  )
                }
              />
            </span>
          }
        />
      ))}
    </SettingsGroup>
  );
}
