import { lazyRoute } from "@/components/workspace/lazy-route";

// The toolkit's settings entry points do not export these pieces; reach them
// through the package's `./app/*` subpath export rather than toolkit source.
export { ConnectionsSettingsContent } from "@agent-native/toolkit/app/settings/SettingsPanel";
export { SettingsShellProvider } from "@agent-native/toolkit/app/settings/shell/context";
export const SkillsSettingsPage = lazyRoute(
  () => import("@agent-native/toolkit/app/settings/shell/pages/skills"),
);
