import { useState, useCallback } from "react";

import { agentNativePath } from "../api-path.js";
import { usePollLoop } from "../use-poll-loop.js";

export interface IntegrationStatus {
  platform: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  details?: Record<string, unknown>;
  error?: string;
  webhookUrl?: string;
}

export function useIntegrationStatus() {
  const [statuses, setStatuses] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatuses = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/integrations/status"),
        { signal },
      );
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = await res.json();
      setStatuses(Array.isArray(data) ? data : []);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  usePollLoop(fetchStatuses, { intervalMs: 30_000 });

  return { statuses, loading, refetch: fetchStatuses };
}
