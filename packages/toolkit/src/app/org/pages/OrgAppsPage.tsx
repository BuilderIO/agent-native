import { useT } from "@agent-native/core/client/i18n";
import {
  useSetWorkspaceAppAccess,
  useWorkspaceAppAccess,
} from "@agent-native/core/client/org";
import type { OrgInfo } from "@agent-native/core/org/types";
import {
  type ModelRow,
  rowIdSegment,
  type ScreenModel,
} from "@agent-native/design-system/model";
import {
  combineFragments,
  type ModelFragment,
  ModelSurface,
  rowAttributes,
  Skeleton,
} from "@agent-native/toolkit/design-system";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@agent-native/toolkit/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { IconApps, IconArrowUpRight } from "@tabler/icons-react";
import { useMemo, type ReactNode } from "react";

import { useSettingsPageHeader } from "../../settings/shell/context.js";
import { useWorkspaceAppPrivacyFragment } from "../AppsAccessSection.js";
import { ErrorText } from "../TeamPrimitives.js";
import { useOrgSwitcherAppLinks } from "../workspace-app-links.js";
import { OrgPageGate } from "./OrgPageGate.js";

function useAppAccessFragment(browseHref: string | null): ModelFragment {
  const t = useT();
  const query = useWorkspaceAppAccess();
  const setAccess = useSetWorkspaceAppAccess();
  const apps = query.data?.apps ?? [];

  if (query.isLoading) {
    return {
      rows: [0, 1].map((index) => ({
        id: `settings.org-apps.access.loading-${index}`,
        part: "settings.content",
        label: t("agentChat.common.loading"),
        slot: "loading",
      })),
      slots: {
        loading: (row) => (
          <div
            {...rowAttributes(row)}
            className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"
            aria-busy="true"
          >
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-8 w-40" />
          </div>
        ),
      },
    };
  }

  if (query.error) {
    return {
      rows: [
        {
          id: "settings.org-apps.access.load-error",
          part: "settings.content",
          label: t("org.applicationsLoadFailed"),
          slot: "load-error",
        },
      ],
      slots: {
        "load-error": (row) => (
          <div
            {...rowAttributes(row)}
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
          >
            <p className="text-sm text-destructive">
              {t("org.applicationsLoadFailed")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t("agentChat.common.retry")}
            </Button>
          </div>
        ),
      },
    };
  }

  if (apps.length === 0) {
    return {
      rows: [
        {
          id: "settings.org-apps.access.empty",
          part: "settings.content",
          label: t("org.applicationsEmpty"),
          slot: "empty",
        },
      ],
      slots: {
        empty: (row) => (
          <Empty {...rowAttributes(row)}>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconApps />
              </EmptyMedia>
              <EmptyTitle>{t("org.applicationsEmpty")}</EmptyTitle>
            </EmptyHeader>
            {browseHref ? (
              <EmptyContent>
                <BrowseAppsAction href={browseHref} />
              </EmptyContent>
            ) : null}
          </Empty>
        ),
      },
    };
  }

  const rows: ModelRow[] = apps.map((app) => ({
    id: `settings.org-apps.access.${rowIdSegment(app.id)}`,
    part: "settings.row",
    kind: "choice",
    label: app.name,
    anchor: `app-access-${app.id}`,
    state: { value: app.mode },
    slot: `app-access-${app.id}`,
  }));
  if (setAccess.error) {
    rows.push({
      id: "settings.org-apps.access.save-error",
      part: "settings.content",
      label: setAccess.error.message,
      slot: "save-error",
    });
  }
  const slots: Record<string, ReactNode | ((row: ModelRow) => ReactNode)> = {
    "save-error": (row) => (
      <div {...rowAttributes(row)} className="px-5 py-3 sm:px-6">
        <ErrorText error={setAccess.error} />
      </div>
    ),
  };
  for (const app of apps) {
    slots[`app-access-${app.id}`] = (
      <Select
        value={app.mode}
        onValueChange={(value) => {
          if (
            value !== "all" &&
            value !== "restricted" &&
            value !== "disabled"
          ) {
            return;
          }
          setAccess.mutate({ appId: app.id, mode: value });
        }}
        disabled={setAccess.isPending}
      >
        <SelectTrigger
          size="sm"
          className="w-40"
          aria-label={t("org.applicationAccess", { name: app.name })}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="all">{t("org.applicationAccessAll")}</SelectItem>
          <SelectItem value="restricted">
            {t("org.applicationAccessRestricted")}
          </SelectItem>
          <SelectItem value="disabled">
            {t("org.applicationAccessDisabled")}
          </SelectItem>
        </SelectContent>
      </Select>
    );
  }
  return { rows, slots };
}

function BrowseAppsAction({ href }: { href: string }) {
  const t = useT();
  return (
    <Button asChild size="sm">
      {/* Cross-app destination: this leaves the app for the apps directory, so it
          opens beside the app (the arrow icon promises a new place) instead of
          replacing the page the reader is working in. */}
      <a href={href} target="_blank" rel="noopener noreferrer">
        {t("agentChat.settingsOrg.apps.browse")}
        <IconArrowUpRight />
      </a>
    </Button>
  );
}

function OrgAppsContent({
  org,
  extraGroups,
}: {
  org: OrgInfo;
  extraGroups?: ReactNode;
}) {
  const t = useT();
  const { isWorkspace, dispatchAllAppsHref } = useOrgSwitcherAppLinks(true);
  const header = useMemo(
    () =>
      isWorkspace
        ? { action: <BrowseAppsAction href={dispatchAllAppsHref} /> }
        : null,
    [dispatchAllAppsHref, isWorkspace],
  );
  useSettingsPageHeader(header);

  const access = useAppAccessFragment(isWorkspace ? dispatchAllAppsHref : null);
  const defaults = useWorkspaceAppPrivacyFragment(
    org.workspaceAppDefaultVisibility ?? "org",
  );
  const runtime = combineFragments([access, defaults]);
  const model: ScreenModel = {
    id: "settings",
    rows: [
      {
        id: "settings.org-apps.access",
        part: "settings.group",
        label: t("agentChat.settingsOrg.apps.access"),
        anchor: "app-access",
        rows: access.rows,
      },
      {
        id: "settings.org-apps.defaults",
        part: "settings.group",
        label: t("agentChat.settingsOrg.apps.defaults"),
        anchor: "app-defaults",
        rows: defaults.rows,
      },
    ],
  };

  return (
    <div className="space-y-8">
      <ModelSurface model={model} slots={runtime.slots} />
      {extraGroups}
    </div>
  );
}

/**
 * Organization › Apps (owners and admins): who can open each workspace app,
 * and the privacy new apps start with. An app adds its own groups after
 * Defaults with `extraGroups`.
 */
export function OrgAppsPage({ extraGroups }: { extraGroups?: ReactNode } = {}) {
  return (
    <OrgPageGate skeletonRows={3}>
      {(org) =>
        org.role === "owner" || org.role === "admin" ? (
          <OrgAppsContent key={org.orgId} org={org} extraGroups={extraGroups} />
        ) : null
      }
    </OrgPageGate>
  );
}
