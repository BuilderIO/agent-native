import { SettingsPage } from "@/pages/SettingsPage";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Settings — Mail" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner />
    </div>
  );
}

export default function SettingsRoute() {
  return <SettingsPage />;
}
