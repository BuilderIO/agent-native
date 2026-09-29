import { lazy, Suspense } from "react";

import { useT } from "../../../i18n.js";
import { SettingsSkeleton } from "../../SettingsSkeleton.js";
import { resolveSettingsAppIdentity } from "../app-identity.js";
import type { SettingsPageProps } from "../registry.js";

const ChannelsPage = lazy(() =>
  import("../../../integrations/ChannelsPage.js").then((module) => ({
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
