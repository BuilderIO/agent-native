import { useT } from "@agent-native/core/client";
import { IconAlertTriangle, IconHeartbeat } from "@tabler/icons-react";
import { useSearchParams } from "react-router";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ErrorsPanel } from "./ErrorsPanel";
import { UptimePanel } from "./UptimePanel";

type MonitoringView = "uptime" | "errors";

function isMonitoringView(value: string | null): value is MonitoringView {
  return value === "uptime" || value === "errors";
}

/**
 * Monitoring tab shell. Hosts two independently-owned panels:
 *  - Uptime  (URL/status/text checks + alerting)
 *  - Errors  (Sentry-style exception capture linked to session replays)
 *
 * The active panel is reflected in the `?view=` query param so links are
 * shareable and the agent can deep-link a specific view via the navigate
 * action. This shell is intentionally thin — panel content lives in the
 * feature-owned UptimePanel / ErrorsPanel modules.
 */
export default function MonitoringPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawView = searchParams.get("view");
  const view: MonitoringView = isMonitoringView(rawView) ? rawView : "uptime";

  // A panel is in a sub-view (full-page form / detail) when it has drilled into
  // a specific record via its own query param. The section-switcher tabs only
  // belong at the list level; inside a sub-view the panel's own "Back" header is
  // the way out. Param names mirror UptimePanel (`monitor`) and ErrorsPanel
  // (`issue`); `monitor=new` counts as a sub-view (the create form).
  const inSubView =
    (view === "uptime" && searchParams.get("monitor") !== null) ||
    (view === "errors" && searchParams.get("issue") !== null);

  const setView = (next: string) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "uptime") params.delete("view");
        else params.set("view", next);
        return params;
      },
      { replace: true },
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Tabs value={view} onValueChange={setView} className="space-y-6">
        {inSubView ? null : (
          <TabsList>
            <TabsTrigger value="uptime" className="gap-2">
              <IconHeartbeat className="h-4 w-4" />
              {t("navigation.monitoringUptime")}
            </TabsTrigger>
            <TabsTrigger value="errors" className="gap-2">
              <IconAlertTriangle className="h-4 w-4" />
              {t("navigation.monitoringErrors")}
            </TabsTrigger>
          </TabsList>
        )}
        <TabsContent value="uptime" className="focus-visible:outline-none">
          <UptimePanel />
        </TabsContent>
        <TabsContent value="errors" className="focus-visible:outline-none">
          <ErrorsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
