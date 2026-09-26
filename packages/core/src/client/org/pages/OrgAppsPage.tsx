import { Skeleton } from "@agent-native/toolkit/design-system";
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
import { useMemo } from "react";

import type { OrgInfo } from "../../../org/types.js";
import { useT } from "../../i18n.js";
import { SettingsGroup, SettingsRow } from "../../settings/SettingsRow.js";
import { useSettingsPageHeader } from "../../settings/shell/context.js";
import { WorkspaceAppPrivacySettingsSection } from "../AppsAccessSection.js";
import { useSetWorkspaceAppAccess, useWorkspaceAppAccess } from "../hooks.js";
import { ErrorText } from "../TeamPrimitives.js";
import { useOrgSwitcherAppLinks } from "../workspace-app-links.js";
import { OrgPageGate } from "./OrgPageGate.js";

function AppAccessRows({ browseHref }: { browseHref: string | null }) {
  const t = useT();
  const query = useWorkspaceAppAccess();
  const setAccess = useSetWorkspaceAppAccess();
  const apps = query.data?.apps ?? [];

  if (query.isLoading) {
    return (
      <>
        {[0, 1].map((index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"
            aria-busy="true"
          >
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-8 w-40" />
          </div>
        ))}
      </>
    );
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
      >
        <p className="text-sm text-destructive">
          {t("org.applicationsLoadFailed")}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("agentChat.common.retry")}
        </Button>
      </div>
    );
  }

  if (apps.length === 0) {
    return (
      <Empty>
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
    );
  }

  return (
    <>
      {apps.map((app) => (
        <SettingsRow
          key={app.id}
          id={`app-access-${app.id}`}
          label={app.name}
          control={
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
                <SelectItem value="all">
                  {t("org.applicationAccessAll")}
                </SelectItem>
                <SelectItem value="restricted">
                  {t("org.applicationAccessRestricted")}
                </SelectItem>
                <SelectItem value="disabled">
                  {t("org.applicationAccessDisabled")}
                </SelectItem>
              </SelectContent>
            </Select>
          }
        />
      ))}
      {setAccess.error ? (
        <div className="px-5 py-3 sm:px-6">
          <ErrorText error={setAccess.error} />
        </div>
      ) : null}
    </>
  );
}

function BrowseAppsAction({ href }: { href: string }) {
  const t = useT();
  return (
    <Button asChild size="sm">
      <a href={href}>
        {t("agentChat.settingsOrg.apps.browse")}
        <IconArrowUpRight />
      </a>
    </Button>
  );
}

function OrgAppsContent({ org }: { org: OrgInfo }) {
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

  return (
    <div className="space-y-8">
      <SettingsGroup
        id="app-access"
        title={t("agentChat.settingsOrg.apps.access")}
      >
        <AppAccessRows browseHref={isWorkspace ? dispatchAllAppsHref : null} />
      </SettingsGroup>
      <SettingsGroup
        id="app-defaults"
        title={t("agentChat.settingsOrg.apps.defaults")}
      >
        <WorkspaceAppPrivacySettingsSection
          visibility={org.workspaceAppDefaultVisibility ?? "org"}
        />
      </SettingsGroup>
    </div>
  );
}

/**
 * Organization › Apps (owners and admins): who can open each workspace app,
 * and the privacy new apps start with.
 */
export function OrgAppsPage() {
  return (
    <OrgPageGate skeletonRows={3}>
      {(org) =>
        org.role === "owner" || org.role === "admin" ? (
          <OrgAppsContent key={org.orgId} org={org} />
        ) : null
      }
    </OrgPageGate>
  );
}
