import { buildLegacyAgentSettingsRoute } from "@agent-native/core/client/navigation";
import { Navigate, useLocation } from "react-router";

import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.settings.agentTitle }];
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
