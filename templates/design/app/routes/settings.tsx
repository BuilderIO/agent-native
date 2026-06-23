import {
  SettingsPanel,
  useDevMode,
  ChangelogSettingsCard,
} from "@agent-native/core/client";
import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: "Settings — Design" }];
}

export default function SettingsRoute() {
  const { isDevMode, canToggle, setDevMode } = useDevMode();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <SettingsPanel
        isDevMode={isDevMode}
        onToggleDevMode={() => setDevMode(!isDevMode)}
        showDevToggle={canToggle}
      />
      <div className="mx-auto w-full max-w-2xl px-4 pb-8">
        <ChangelogSettingsCard markdown={changelog} />
      </div>
    </div>
  );
}
