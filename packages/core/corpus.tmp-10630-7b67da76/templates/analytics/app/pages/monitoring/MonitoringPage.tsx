import { AgentToggleButton, useT } from "@agent-native/core/client";
import { RunsTray } from "@agent-native/core/client/progress";
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

  // A panel is in a sub-view (full-page form / detail / status-page config) when
  // it has drilled in via its own query param. The section-switcher tabs only
  // belong at the list level; inside a sub-view the panel's own "Back" header is
  // the way out. Param names mirror UptimePanel (`monitor`, `statuspage`) and
  // ErrorsPanel (`issue`); `monitor=new` / `statuspage=list` count as sub-views.
  const inSubView =
    (view === "uptime" &&
      (searchParams.get("monitor") !== null ||
        searchParams.get("statuspage") !== null)) ||
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

  const toggles = (
    <div className="flex shrink-0 items-center gap-2">
      <RunsTray pollMs={0} />
      <AgentToggleButton />
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Tabs value={view} onValueChange={setView} className="space-y-6">
        {/* List level: one header row with the section switcher on the left and
            the relocated agent/chat toggle on the right (replacing the
            suppressed framework Header). */}
        {inSubView ? null : (
          <div className="flex items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger
                value="uptime"
                className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                <IconHeartbeat className="h-4 w-4" />
                {t("navigation.monitoringUptime")}
              </TabsTrigger>
              <TabsTrigger
                value="errors"
                className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                <IconAlertTriangle className="h-4 w-4" />
                {t("navigation.monitoringErrors")}
              </TabsTrigger>
            </TabsList>
            {toggles}
          </div>
        )}
        {/* Sub-view: overlay the toggle at the top-right so it sits on the same
            row as the panel's own "Back" header instead of a lone row above. */}
        <div className={inSubView ? "relative" : undefined}>
          {inSubView ? (
            <div className="absolute end-0 top-0 z-20">{toggles}</div>
          ) : null}
          <TabsContent value="uptime" className="focus-visible:outline-none">
            <UptimePanel />
          </TabsContent>
          <TabsContent value="errors" className="focus-visible:outline-none">
            <ErrorsPanel />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
