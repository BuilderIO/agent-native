import { buildLegacyAgentSettingsRoute } from "@agent-native/core/client/navigation";
import { Navigate, useLocation } from "react-router";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.agentTitle }];
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
