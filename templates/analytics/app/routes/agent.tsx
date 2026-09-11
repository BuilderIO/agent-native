import { buildLegacyAgentSettingsRoute } from "@agent-native/core/client/navigation";
import { Navigate, useLocation } from "react-router";

export default function AgentRoute() {
  const location = useLocation();

  return (
    <Navigate
      to={buildLegacyAgentSettingsRoute(location.hash, location.search)}
      replace
    />
  );
}
