import { useT } from "@agent-native/core/client/i18n";
import { ProviderReadinessBadge } from "@agent-native/toolkit/app/setup-connections";

import type { Readiness } from "./connection-rows";

/** The toolkit's readiness badge with this app's words on it. */
export function ReadinessChip({ readiness, word }: Readiness) {
  const t = useT();
  const words = {
    connected: t("settings.factory.connected"),
    notConnected: t("settings.factory.notConnected"),
    couldNotCheck: t("settings.factory.couldNotCheck"),
    needsAttention: t("settings.factory.needsAttention"),
  };
  return <ProviderReadinessBadge status={readiness} label={words[word]} />;
}
