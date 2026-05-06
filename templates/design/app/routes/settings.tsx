import { SettingsPanel, useDevMode } from "@agent-native/core/client";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Settings — Design" }];
}

export function HydrateFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Spinner className="size-8" />
    </div>
  );
}

export default function SettingsRoute() {
  const { isDevMode, canToggle, setDevMode } = useDevMode();

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <SettingsPanel
        isDevMode={isDevMode}
        onToggleDevMode={() => setDevMode(!isDevMode)}
        showDevToggle={canToggle}
      />
    </div>
  );
}
