import { messagesByLocale } from "@/i18n-data";
import Settings from "@/pages/Settings";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.settings }];
}

export default function SettingsRoute() {
  return <Settings />;
}
