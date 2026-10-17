import { useT } from "@agent-native/core/client/i18n";
import { lazy, Suspense } from "react";

import { SettingsSkeleton } from "../../SettingsSkeleton.js";
import { resolveSettingsAppIdentity } from "../app-identity.js";
import type { SettingsPageProps } from "../registry.js";

const ChannelsPage = lazy(() =>
  import("../../../integrations/index.js").then((module) => ({
    default: module.ChannelsPage,
  })),
);

export default function ChannelsSettingsPage({
  context,
  sub,
}: SettingsPageProps) {
  const t = useT();
  return (
    <Suspense fallback={<SettingsSkeleton lines={4} />}>
      <ChannelsPage
        sub={sub}
        context={context}
        appName={
          resolveSettingsAppIdentity({ appId: context.appId }).name ??
          t("agentChat.settingsShell.appFallbackName")
        }
      />
    </Suspense>
  );
}
