import { buildLegacyAgentSettingsRoute } from "@agent-native/core/client/navigation";
import { Navigate, useLocation } from "react-router";

import enUSMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enUSMessages.settings.agentTitle }];
}

export default function AgentRoute() {
  const location = useLocation();
  return (
    <Navigate
      to={buildLegacyAgentSettingsRoute(location.hash, location.search)}
      replace
    />
  );
}
