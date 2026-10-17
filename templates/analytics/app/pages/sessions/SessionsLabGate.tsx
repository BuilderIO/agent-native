import { useT } from "@agent-native/core/client/i18n";
import type { useLabState } from "@agent-native/core/client/labs";
import { IconRefresh } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { ANALYTICS_SESSIONS_TRIAGE_LAB } from "../../../shared/labs";

const LAB_SETTINGS_PATH = `/settings/labs/lab-${ANALYTICS_SESSIONS_TRIAGE_LAB.key}`;

/**
 * A Sessions page that exists only with the Sessions triage Lab on. A Lab
 * state that failed to load says so, with Retry: telling a user whose Lab is
 * on to turn it on would send them to a setting that is already right.
 */
export function SessionsLabGate({
  lab,
  needsLab,
  children,
}: {
  lab: ReturnType<typeof useLabState>;
  needsLab: string;
  children: ReactNode;
}) {
  const t = useT();
  if (lab.isLoading) return <Skeleton className="h-40 w-full" />;
  if (lab.enabled) return <>{children}</>;
  return (
    <Card>
      {lab.isError ? (
        <div className="space-y-3 p-6 text-sm" role="status">
          <p>{t("sessions.labFeaturesUnavailable")}</p>
          <Button variant="outline" size="sm" onClick={lab.refetch}>
            <IconRefresh />
            {t("sidebar.retry")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 p-6 text-sm">
          <p>{needsLab}</p>
          <Button asChild variant="outline" size="sm">
            <Link to={LAB_SETTINGS_PATH}>{t("sessions.openLabSettings")}</Link>
          </Button>
        </div>
      )}
    </Card>
  );
}
