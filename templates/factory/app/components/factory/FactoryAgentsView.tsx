import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  ActionQueryError,
  CreateAppPopover,
  SimpleAgentsPanel,
  WorkspaceAppCard,
} from "@agent-native/dispatch/components";
import { IconPlus } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

interface WorkspaceAppSummary {
  id: string;
  name: string;
  description?: string;
  path: string;
  url: string | null;
  isDispatch: boolean;
  status?: "ready" | "pending";
  statusLabel?: string;
}

function CreateAppButton({ label }: { label: string }) {
  return (
    <Button size="sm">
      <IconPlus size={15} />
      {label}
    </Button>
  );
}

function AgenticAppsSection({ t }: { t: ReturnType<typeof useT> }) {
  const query = useActionQuery<WorkspaceAppSummary[]>("list-workspace-apps", {
    includeAgentCards: false,
  });
  const apps = (query.data ?? []).filter((app) => !app.isDispatch);
  const createAppLabel = t("factoryRoute.createApp");

  if (query.isError) {
    return (
      <ActionQueryError
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium text-foreground">
          {t("factoryRoute.agenticAppsTitle")}
        </h2>
        {apps.length > 0 ? (
          <CreateAppPopover
            align="end"
            trigger={<CreateAppButton label={createAppLabel} />}
            onCreated={() => void query.refetch()}
          />
        ) : null}
      </div>
      {query.isLoading && apps.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-24 animate-pulse rounded-2xl border bg-muted"
            />
          ))}
        </div>
      ) : apps.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {apps.map((app) => (
            <WorkspaceAppCard
              key={app.id}
              app={app}
              className="rounded-2xl border bg-card px-4 py-4"
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed bg-card px-4 py-12 text-center">
          <div className="text-sm font-medium text-foreground">
            {t("factoryRoute.agenticAppsEmpty")}
          </div>
          <div className="mt-4 flex justify-center">
            <CreateAppPopover
              trigger={<CreateAppButton label={createAppLabel} />}
              onCreated={() => void query.refetch()}
            />
          </div>
        </div>
      )}
    </section>
  );
}

export function FactoryAgentsView() {
  const t = useT();

  return (
    <div className="flex flex-col gap-8 p-6 lg:p-8">
      <AgenticAppsSection t={t} />
      <SimpleAgentsPanel title={t("factoryRoute.agentsTitle")} />
    </div>
  );
}
