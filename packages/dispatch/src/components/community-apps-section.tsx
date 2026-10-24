import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useLab } from "@agent-native/core/client/labs";
import {
  IconArrowUpRight,
  IconCircleCheck,
  IconPlus,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { COMMUNITY_APPS_LAB } from "../shared/labs.js";
import { ActionQueryError } from "./action-query-error";
import { AppIcon } from "./app-icon";
import { AppList, AppListRow } from "./app-list-row";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Spinner } from "./ui/spinner";

interface CommunityAppSource {
  id: string;
  name: string;
  description?: string;
  appId: string;
  repo: string;
  ref: string;
  license: string;
  provenance: string;
  templatePath: string;
  installed: boolean;
  pending: boolean;
  installable: boolean;
  installUnavailableReason?:
    | "workspace-required"
    | "app-id-conflict"
    | "builder-install-unverified";
}

function pinnedSourceUrl(source: CommunityAppSource): string {
  return (
    "https://github.com/" +
    source.repo +
    "/tree/" +
    source.ref +
    "/" +
    source.templatePath
  );
}

export function CommunityAppsSection() {
  const t = useT();
  const enabled = useLab(COMMUNITY_APPS_LAB);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const catalogQuery = useActionQuery<CommunityAppSource[]>(
    "list-curated-community-apps" as never,
    {},
    { enabled },
  );
  const workspaceAppsQuery = useActionQuery("list-workspace-apps", {
    includeAgentCards: false,
    includeArchived: true,
  });
  const install = useActionMutation("install-curated-community-app", {
    onSuccess: (result) => {
      const mode = (result as { mode?: string } | null)?.mode;
      const message = (result as { message?: string } | null)?.message;
      if (mode === "builder") {
        toast.success(t("dispatch.pages.communityAppsInstallStarted"));
      } else if (mode === "pending") {
        toast.info(t("dispatch.pages.communityAppsPending"));
      } else if (mode === "already-installed") {
        toast.success(t("dispatch.pages.communityAppsAlreadyInstalled"));
      } else if (mode === "builder-unavailable" || mode === "app-id-taken") {
        toast.error(message || t("dispatch.pages.communityAppsInstallFailed"));
      } else if (mode === "local-agent") {
        sendToAgentChat({
          message:
            (result as { prompt?: string } | null)?.prompt ||
            t("dispatch.pages.communityAppsLocalRequestReady"),
          attachments: (
            result as {
              attachments?: Array<{
                type: "file";
                name: string;
                contentType: string;
                text: string;
              }>;
            } | null
          )?.attachments,
          submit: true,
          type: "code",
          newTab: true,
          reuseEmptyTab: true,
        });
        toast.info(t("dispatch.pages.communityAppsLocalRequestReady"));
      } else {
        toast.error(t("dispatch.pages.communityAppsInstallFailed"));
      }
      setInstallingId(null);
      void catalogQuery.refetch();
      void workspaceAppsQuery.refetch();
    },
    onError: () => {
      setInstallingId(null);
      toast.error(t("dispatch.pages.communityAppsInstallFailed"));
    },
  });

  if (!enabled) return null;

  return (
    <section className="space-y-3 border-t pt-6">
      <h2 className="text-sm font-semibold text-foreground">
        {t("dispatch.pages.communityApps")}
      </h2>
      {catalogQuery.isError ? (
        <ActionQueryError
          error={catalogQuery.error}
          onRetry={() => void catalogQuery.refetch()}
        />
      ) : catalogQuery.isLoading ? (
        <AppList className="divide-y rounded-xl border">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-4 w-40" />
          </div>
        </AppList>
      ) : catalogQuery.data?.length ? (
        <AppList className="divide-y rounded-xl border">
          {catalogQuery.data.map((source) => (
            <AppListRow key={source.id} className="border-b-0">
              <AppIcon id={source.id} name={source.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-foreground">
                    {source.name}
                  </h3>
                  {source.installed ? (
                    <Badge variant="secondary" className="gap-1">
                      <IconCircleCheck size={13} />
                      {t("dispatch.pages.communityAppsInstalled")}
                    </Badge>
                  ) : source.pending ? (
                    <Badge variant="secondary">
                      {t("dispatch.pages.communityAppsPending")}
                    </Badge>
                  ) : null}
                </div>
                {source.description ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {source.description}
                  </p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span>
                    {t("dispatch.pages.communityAppsLicense")}: {source.license}
                  </span>
                  <a
                    href={pinnedSourceUrl(source)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("dispatch.pages.communityAppsTemplateSource")}
                    <IconArrowUpRight size={12} aria-hidden="true" />
                  </a>
                </div>
              </div>
              {source.installable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={install.isPending}
                  onClick={() => {
                    setInstallingId(source.id);
                    install.mutate({ sourceId: source.id });
                  }}
                >
                  {install.isPending && installingId === source.id ? (
                    <Spinner className="mr-1.5" />
                  ) : (
                    <IconPlus size={14} className="mr-1.5" />
                  )}
                  {install.isPending && installingId === source.id
                    ? t("dispatch.pages.communityAppsInstalling")
                    : t("dispatch.pages.communityAppsInstall")}
                </Button>
              ) : !source.installed &&
                !source.pending &&
                source.installUnavailableReason === "workspace-required" ? (
                <span className="max-w-48 text-right text-xs text-muted-foreground">
                  {t("dispatch.pages.communityAppsWorkspaceRequired")}
                </span>
              ) : !source.installed &&
                !source.pending &&
                source.installUnavailableReason === "app-id-conflict" ? (
                <span className="max-w-48 text-right text-xs text-muted-foreground">
                  {t("dispatch.pages.communityAppsIdConflict")}
                </span>
              ) : !source.installed &&
                !source.pending &&
                source.installUnavailableReason ===
                  "builder-install-unverified" ? (
                <span className="max-w-48 text-right text-xs text-muted-foreground">
                  {t("dispatch.pages.communityAppsBuilderInstallUnavailable")}
                </span>
              ) : null}
            </AppListRow>
          ))}
        </AppList>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("dispatch.pages.communityAppsEmpty")}
        </p>
      )}
    </section>
  );
}
