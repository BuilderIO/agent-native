import { SettingsPage } from "@/pages/SettingsPage";

export function meta() {
  return [{ title: "Settings — Mail" }];
}

export default function SettingsRoute() {
  return <SettingsPage />;
}
