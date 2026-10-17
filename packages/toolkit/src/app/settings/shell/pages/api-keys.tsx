import ApiKeysSettingsPage from "../../api-keys/ApiKeysSettingsPage.js";
import type { SettingsPageProps } from "../registry.js";

// No bridge fallback: the `keys` tab templates pass comes from core's own
// `useAgentSettingsTabs` and carries the legacy Secrets section this replaces.
export default function ApiKeysPage(props: SettingsPageProps) {
  return <ApiKeysSettingsPage {...props} />;
}
