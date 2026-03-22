import { SettingsPage } from "@/pages/SettingsPage";
import { MailSkeleton } from "@/components/layout/MailSkeleton";

export function meta() {
  return [{ title: "Settings — Mail" }];
}

export function HydrateFallback() {
  return <MailSkeleton />;
}

export default function SettingsRoute() {
  return <SettingsPage />;
}
