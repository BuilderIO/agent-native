import { SettingsPanel, useDevMode } from "@agent-native/core/client";

export function meta() {
  return [{ title: "Settings — Design" }];
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
