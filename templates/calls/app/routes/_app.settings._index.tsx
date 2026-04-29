import { IconSettings } from "@tabler/icons-react";
import { SettingsShell } from "@/components/workspace/settings-shell";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Settings · Calls" }];
}

export default function SettingsIndexRoute() {
  useSetPageTitle(
    <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2 truncate">
      <IconSettings className="h-5 w-5 text-[#625DF5]" />
      Settings
    </h1>,
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <SettingsShell defaultTab="workspace" />
      </div>
    </div>
  );
}
