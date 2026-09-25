import { Skeleton } from "@agent-native/toolkit/design-system";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";

import { useT } from "../i18n.js";
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";
import {
  useOrg,
  useSetWorkspaceAppDefaultVisibility,
  useWorkspaceAppAccess,
  useSetWorkspaceAppAccess,
} from "./hooks.js";
import { ErrorText, SectionTooltipProvider } from "./TeamPrimitives.js";

export function WorkspaceAppPrivacySettingsSection({
  visibility,
}: {
  visibility: "private" | "org";
}) {
  const t = useT();
  const setDefault = useSetWorkspaceAppDefaultVisibility();
  return (
    <SettingsRow
      id="workspace-app-default-visibility"
      label={t("org.workspaceAppsDefaultPrivacy", {
        defaultValue: "New app privacy",
      })}
      description={t("org.workspaceAppsDefaultPrivacyDescription", {
        defaultValue:
          "Choose whether new workspace apps start private to their creator or visible to the organization.",
      })}
      control={
        <Select
          value={visibility}
          onValueChange={(value) =>
            setDefault.mutate(value === "private" ? "private" : "org")
          }
          disabled={setDefault.isPending}
        >
          <SelectTrigger className="h-auto w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs sm:w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="org">
              {t("org.workspaceAppsOrganization", {
                defaultValue: "Organization",
              })}
            </SelectItem>
            <SelectItem value="private">
              {t("org.workspaceAppsCreatorOnly", {
                defaultValue: "Creator only",
              })}
            </SelectItem>
          </SelectContent>
        </Select>
      }
    />
  );
}

export function WorkspaceApplicationsSection() {
  const t = useT();
  const query = useWorkspaceAppAccess();
  const setAccess = useSetWorkspaceAppAccess();
  const apps = query.data?.apps ?? [];

  return (
    <section className="border-t border-border/60 px-5 pt-4">
      <h3 className="text-sm font-medium">{t("org.applications")}</h3>
      {query.isLoading ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : query.error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {t("org.applicationsLoadFailed")}
        </p>
      ) : apps.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("org.applicationsEmpty")}
        </p>
      ) : (
        <div className="mt-2 divide-y divide-border/60">
          {apps.map((app) => (
            <div
              key={app.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">{app.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {app.id}
                </p>
              </div>
              <Select
                value={app.mode}
                onValueChange={(value) => {
                  if (
                    value !== "all" &&
                    value !== "restricted" &&
                    value !== "disabled"
                  )
                    return;
                  setAccess.mutate({ appId: app.id, mode: value });
                }}
                disabled={setAccess.isPending}
              >
                <SelectTrigger
                  className="h-auto w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs sm:w-36"
                  aria-label={t("org.applicationAccess", { name: app.name })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
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
            </div>
          ))}
        </div>
      )}
      <ErrorText error={setAccess.error} />
    </section>
  );
}

/**
 * New app privacy and per-app access for the active organization. Owners and
 * admins only; renders nothing otherwise.
 */
export function AppsAccessSection({ title }: { title?: string }) {
  const { data: org } = useOrg();

  if (!org?.orgId || (org.role !== "owner" && org.role !== "admin")) {
    return null;
  }

  return (
    <SectionTooltipProvider>
      <SettingsGroup title={title}>
        <WorkspaceAppPrivacySettingsSection
          visibility={org.workspaceAppDefaultVisibility ?? "org"}
        />
        <WorkspaceApplicationsSection />
      </SettingsGroup>
    </SectionTooltipProvider>
  );
}
