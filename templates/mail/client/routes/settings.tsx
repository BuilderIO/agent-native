import { SettingsPage } from "@/pages/SettingsPage";

export function meta() {
  return [{ title: "Settings — Mail" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function SettingsRoute() {
  return <SettingsPage />;
}
