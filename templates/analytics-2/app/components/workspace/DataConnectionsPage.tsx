import { AppSettingsSections } from "@/skins/app-settings-sections";

import { useDataConnectionsPageSections } from "./useDataConnectionsPageSections";

/**
 * Settings → Data sources (workspace Data connections).
 *
 * Source composition: an admin page titled "Data sources" whose connections
 * panel lists workspace connections, lets an admin add one, edit configuration,
 * and make a shared connection the workspace default. Credential inputs are
 * write-only; the edit read returns safe values and which fields already exist.
 */
export function DataConnectionsPage() {
  return (
    <AppSettingsSections
      sections={useDataConnectionsPageSections()}
      title="Data sources"
      description="Data that can be shared among all users or groups of users in the workspace."
      hints={{ frame: "panel" }}
    />
  );
}
