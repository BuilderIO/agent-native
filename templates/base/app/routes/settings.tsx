import {
  AccountSettingsCard,
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/core/client/settings";
import { Link } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

export default function SettingsPage() {
  const agentSettingsTabs = useAgentSettingsTabs();

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <Link
          to="/"
          className="text-[13px] text-muted-foreground hover:text-foreground"
        >
          Back home
        </Link>
        <SettingsTabsPage
          account={<AccountSettingsCard />}
          extraTabs={agentSettingsTabs}
          general={<div className="mx-auto w-full max-w-2xl" />}
        />
      </div>
    </main>
  );
}
