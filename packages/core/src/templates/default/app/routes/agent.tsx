import { buildLegacyAgentSettingsRoute } from "@agent-native/core/client/navigation";
import { Navigate, useLocation } from "react-router";

export function meta() {
  return [{ title: "Agent - {{APP_TITLE}}" }];
}

export default function AgentPage() {
  const location = useLocation();
  return (
    <Navigate
      to={buildLegacyAgentSettingsRoute(location.hash, location.search)}
      replace
    />
  );
}
