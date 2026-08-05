import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { Navigate, useLocation } from "react-router";

export function meta() {
  return [{ title: "Agent settings" }];
}

export default function AgentRoute() {
  const t = useT();
  const location = useLocation();
  useSetPageTitle(t("settings.agentTitle"));

  const legacyTab = location.hash.replace(/^#/, "").toLowerCase();
  const resourceTabs = new Set([
    "files",
    "instructions",
    "agents",
    "memory",
    "skills",
    "learnings",
  ]);
  const destination = resourceTabs.has(legacyTab)
    ? `/settings#agent:resources:${legacyTab}`
    : legacyTab === "remote-agents"
      ? "/settings#agent:agents"
      : legacyTab === "connections"
        ? "/settings#integrations"
        : legacyTab === "jobs"
          ? "/settings#agent:automations"
          : legacyTab === "access"
            ? "/settings#agent:access"
            : ["llm", "app-models", "limits", "voice", "background"].includes(
                  legacyTab,
                )
              ? `/settings#${legacyTab}`
              : "/settings#agent";

  return <Navigate to={destination} replace />;
}
