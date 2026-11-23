import { useT } from "@agent-native/core/client/i18n";
import {
  IconLock,
  IconUsers,
  IconBuilding,
  IconFolder,
} from "@tabler/icons-react";

import { Skeleton } from "@/components/ui/skeleton";

export interface ProjectAccessSummary {
  role: "owner" | "admin" | "editor" | "commenter" | "viewer";
  userCount: number;
  groupCount: number;
  collectionCount: number;
  workspaceShared: boolean;
  ownerOnly: boolean;
}

export function ProjectAccessCell({
  summary,
  field,
  workspaceName,
  status = "ready",
}: {
  summary?: ProjectAccessSummary | undefined;
  field: "yourAccess" | "sharedWith";
  workspaceName?: string | undefined;
  status?: "loading" | "error" | "ready";
}) {
  const t = useT();
  if (status === "loading")
    return (
      <span role="status" aria-busy="true">
        <span className="sr-only">
          {t("dashboards.list.permissions.loading")}
        </span>
        <Skeleton className="h-4 w-20" />
      </span>
    );
  if (status === "error" || !summary)
    return <span role="alert">{t("dashboards.list.permissions.failed")}</span>;
  if (field === "yourAccess") {
    const roleKeys: Record<string, string> = {
      owner: "fullAccess",
      admin: "fullAccess",
      editor: "canEdit",
      commenter: "canExplore",
      viewer: "canExplore",
    };
    const key = roleKeys[summary.role];
    return key ? (
      <span>{t(`analytics.lists.${key}`)}</span>
    ) : (
      <span role="alert">{t("dashboards.list.permissions.unknownAccess")}</span>
    );
  }
  const { userCount, groupCount, collectionCount, workspaceShared, ownerOnly } =
    summary;
  const parts = [
    userCount && !ownerOnly
      ? t(
          userCount === 1
            ? "analytics.lists.sharedUser"
            : "analytics.lists.sharedUsers",
          { count: userCount },
        )
      : null,
    groupCount
      ? t(
          groupCount === 1
            ? "analytics.lists.sharedGroup"
            : "analytics.lists.sharedGroups",
          { count: groupCount },
        )
      : null,
    collectionCount
      ? t(
          collectionCount === 1
            ? "analytics.lists.sharedCollection"
            : "analytics.lists.sharedCollections",
          { count: collectionCount },
        )
      : null,
  ].filter(Boolean);
  const text = workspaceShared
    ? workspaceName
      ? t("analytics.lists.allOfWorkspace", { name: workspaceName })
      : t("dashboards.list.permissions.workspace")
    : parts.length
      ? parts.join(", ")
      : t(
          ownerOnly
            ? "analytics.lists.onlyYouSharing"
            : "analytics.lists.noAccessSharing",
        );
  const Icon = workspaceShared
    ? IconBuilding
    : (userCount && !ownerOnly) || groupCount
      ? IconUsers
      : collectionCount
        ? IconFolder
        : IconLock;
  return (
    <span className="inline-flex items-center gap-1.5" title={text}>
      <Icon size={14} aria-hidden="true" />
      {text}
    </span>
  );
}
