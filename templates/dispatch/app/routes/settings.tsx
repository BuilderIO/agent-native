import { DispatchSettingsPage } from "@agent-native/dispatch/routes/pages/settings";

import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.settings }];
}

export default function SettingsRoute() {
  return <DispatchSettingsPage changelog={changelog} />;
}
