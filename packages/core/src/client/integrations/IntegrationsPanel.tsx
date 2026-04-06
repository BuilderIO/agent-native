import React from "react";
import { useIntegrationStatus } from "./useIntegrationStatus.js";
import { IntegrationCard } from "./IntegrationCard.js";

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-9 rounded-md border border-border bg-muted/50 animate-pulse"
        />
      ))}
    </div>
  );
}

export function IntegrationsPanel() {
  const { statuses, loading, refetch } = useIntegrationStatus();

  return (
    <div>
      <div className="mb-1.5">
        <div className="text-xs font-medium text-foreground">Integrations</div>
        <div className="text-[10px] text-muted-foreground">
          Connect your agent to messaging platforms
        </div>
      </div>
      {loading ? (
        <LoadingSkeleton />
      ) : statuses.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          No integrations available.
        </p>
      ) : (
        <div className="space-y-1.5">
          {statuses.map((s) => (
            <IntegrationCard key={s.platform} status={s} onRefresh={refetch} />
          ))}
        </div>
      )}
    </div>
  );
}
