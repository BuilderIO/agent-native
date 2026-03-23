import Settings from "@/pages/Settings";

export function meta() {
  return [{ title: "Settings — Deck Generator" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function SettingsRoute() {
  return <Settings />;
}
