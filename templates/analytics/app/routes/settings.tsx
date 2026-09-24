import enUSMessages from "@/i18n/en-US";
import Settings from "@/pages/Settings";

export function meta() {
  return [{ title: enUSMessages.routeTitles.settings }];
}

export default function SettingsRoute() {
  return <Settings />;
}
