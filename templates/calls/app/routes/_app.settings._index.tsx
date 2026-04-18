import { IconSettings } from "@tabler/icons-react";
import { SettingsShell } from "@/components/workspace/settings-shell";

export function meta() {
  return [{ title: "Settings · Calls" }];
}

export default function SettingsIndexRoute() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <IconSettings className="h-6 w-6 text-[#625DF5]" />
          Settings
        </h1>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <SettingsShell defaultTab="workspace" />
      </div>
    </div>
  );
}
