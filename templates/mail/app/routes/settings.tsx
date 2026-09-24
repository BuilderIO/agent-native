import messages from "@/i18n/en-US";
import { SettingsPage } from "@/pages/SettingsPage";

export function meta() {
  return [{ title: messages.mail.routeTitles.settings }];
}

export default function SettingsRoute() {
  return <SettingsPage />;
}
