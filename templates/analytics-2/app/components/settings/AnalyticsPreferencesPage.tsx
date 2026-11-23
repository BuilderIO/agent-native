import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup } from "@agent-native/toolkit/app/settings";

import { Skeleton } from "@/components/ui/skeleton";

import { AnalyticsWorkspaceName } from "./AnalyticsWorkspaceName";

/**
 * Settings → Workspace → General.
 *
 * The source's General view for a workspace (views/org-admin/OrgGeneralView.tsx)
 * is a page with the sentence "Manage general settings for the workspace." above
 * the SQL formatting panel and the workspace's display name. This renders the
 * same three parts in that order: the sentence, the formatting panel, and the
 * name control, which is the part with a write path here.
 */
type FormattingPreferences = {
  options?: {
    keywordCase?: string;
    newlineBeforeClauses?: boolean;
  };
};

export function AnalyticsPreferencesPage() {
  const t = useT();
  const formatting = useActionQuery<FormattingPreferences>(
    "get-sql-formatting-preferences",
    {},
    { retry: 1 },
  );

  return (
    <div className="space-y-6">
      {/* The source's own sentence for this page. */}
      <p className="text-sm text-muted-foreground">
        Manage general settings for the workspace.
      </p>
      <SettingsGroup
        id="settings-general-sql-formatting"
        title={t("analytics.settings.preferences.general")}
        description={t("analytics.settings.preferences.generalDescription")}
      >
        {formatting.error ? (
          <p role="alert" className="px-5 py-4 text-sm text-destructive">
            {t("analytics.settings.preferences.loadError")}
          </p>
        ) : formatting.isLoading ? (
          <div
            aria-label={t("analytics.settings.preferences.loading")}
            className="px-5 py-4 text-sm text-muted-foreground"
            role="status"
          >
            <span className="sr-only">
              {t("analytics.settings.preferences.loading")}
            </span>
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </div>
        ) : (
          <dl className="space-y-1 px-5 py-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">
                {t("analytics.settings.preferences.keywordCase")}
              </dt>
              <dd>{formatting.data?.options?.keywordCase ?? "upper"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">
                {t("analytics.settings.preferences.newlineBeforeClauses")}
              </dt>
              <dd>
                {formatting.data?.options?.newlineBeforeClauses === false
                  ? "Off"
                  : "On"}
              </dd>
            </div>
          </dl>
        )}
      </SettingsGroup>
      <div id="settings-general-workspace-name">
        <AnalyticsWorkspaceName editLabel="Edit workspace name" />
      </div>
    </div>
  );
}
