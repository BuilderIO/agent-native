import { useT } from "@agent-native/core/client/i18n";
import {
  useOrg,
  useSetWorkspaceAppDefaultVisibility,
  useWorkspaceAppAccess,
  useSetWorkspaceAppAccess,
} from "@agent-native/core/client/org";
import type { RowAttributes } from "@agent-native/design-system/model";
import {
  combineFragments,
  type ModelFragment,
  ModelSurface,
  rowAttributes,
  Skeleton,
} from "@agent-native/toolkit/design-system";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";

import { ErrorText, SectionTooltipProvider } from "./TeamPrimitives.js";

/** New app privacy: who a new workspace app starts visible to. */
export function useWorkspaceAppPrivacyFragment(
  visibility: "private" | "org",
): ModelFragment {
  const t = useT();
  const setDefault = useSetWorkspaceAppDefaultVisibility();
  return {
    rows: [
      {
        id: "settings.org.workspace-app-default-visibility",
        part: "settings.row",
        kind: "choice",
        label: t("org.workspaceAppsDefaultPrivacy", {
          defaultValue: "New app privacy",
        }),
        description: t("org.workspaceAppsDefaultPrivacyDescription", {
          defaultValue:
            "Choose whether new workspace apps start private to their creator or visible to the organization.",
        }),
        anchor: "workspace-app-default-visibility",
        state: { value: visibility },
        slot: "workspace-app-default-visibility",
      },
    ],
    slots: {
      "workspace-app-default-visibility": (
        <Select
          value={visibility}
          onValueChange={(value) =>
            setDefault.mutate(value === "private" ? "private" : "org")
          }
          disabled={setDefault.isPending}
        >
          <SelectTrigger
            size="sm"
            className="w-40"
            aria-label={t("org.workspaceAppsDefaultPrivacy", {
              defaultValue: "New app privacy",
            })}
          >
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
      ),
    },
  };
}

export function WorkspaceAppPrivacySettingsSection({
  visibility,
}: {
  visibility: "private" | "org";
}) {
  const fragment = useWorkspaceAppPrivacyFragment(visibility);
  return (
    <ModelSurface
      model={{ id: "settings", rows: fragment.rows }}
      slots={fragment.slots}
    />
  );
}

/** The per-app access list, drawn as a content row of its group. */
export function useWorkspaceApplicationsFragment(): ModelFragment {
  const t = useT();
  return {
    rows: [
      {
        id: "settings.org.applications",
        part: "settings.content",
        label: t("org.applications"),
        slot: "applications",
      },
    ],
    slots: {
      applications: (row) => (
        <WorkspaceApplications attributes={rowAttributes(row)} />
      ),
    },
  };
}

function WorkspaceApplications({ attributes }: { attributes: RowAttributes }) {
  const t = useT();
  const query = useWorkspaceAppAccess();
  const setAccess = useSetWorkspaceAppAccess();
  const apps = query.data?.apps ?? [];

  return (
    <section {...attributes} className="border-t border-border/60 px-5 pt-4">
      <h3 className="text-sm font-medium">{t("org.applications")}</h3>
      {query.isLoading ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
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
                  size="sm"
                  className="w-full sm:w-40"
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
    <AppsAccessGroup
      title={title}
      visibility={org.workspaceAppDefaultVisibility ?? "org"}
    />
  );
}

function AppsAccessGroup({
  title,
  visibility,
}: {
  title: string | undefined;
  visibility: "private" | "org";
}) {
  const t = useT();
  const content = combineFragments([
    useWorkspaceAppPrivacyFragment(visibility),
    useWorkspaceApplicationsFragment(),
  ]);

  return (
    <SectionTooltipProvider>
      <ModelSurface
        model={{
          id: "settings",
          rows: [
            {
              id: "settings.org.apps-access",
              part: "settings.group",
              ...(title
                ? { label: title }
                : {
                    label: t("agentChat.settingsShell.page.apps"),
                    labelHidden: true,
                  }),
              rows: content.rows,
            },
          ],
        }}
        slots={content.slots}
      />
    </SectionTooltipProvider>
  );
}
