import { AppSettingsSections } from "@/skins/app-settings-sections";

import { useAnalyticsWorkspaceNameSections } from "./useAnalyticsWorkspaceNameSections";

export function AnalyticsWorkspaceName({
  editLabel,
}: {
  /** The control's own label; the workspace General page names it in full. */
  editLabel?: string | undefined;
} = {}) {
  return (
    <AppSettingsSections
      sections={useAnalyticsWorkspaceNameSections({ editLabel })}
      hints={{ frame: "group" }}
    />
  );
}
