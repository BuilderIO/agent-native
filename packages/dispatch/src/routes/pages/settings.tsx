import packageChangelog from "../../../CHANGELOG.md?raw";
import { DispatchSettingsPage } from "./settings-page.js";

export { DispatchSettingsPage };
export type { DispatchSettingsPageProps } from "./settings-page.js";
export { meta } from "./settings-page.js";

export default function SettingsRoute() {
  return <DispatchSettingsPage changelog={packageChangelog} />;
}
