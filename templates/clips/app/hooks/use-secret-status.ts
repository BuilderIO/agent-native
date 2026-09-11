import { agentNativePath } from "@agent-native/core/client/api-path";
import { useCallback, useEffect, useState } from "react";

export interface SecretStatus {
  /** Key name to whether a value is stored for it. */
  configured: Record<string, boolean>;
  /** Last four characters of ad-hoc secrets, when the store exposes them. */
  last4: Record<string, string>;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Which API keys and storage credentials are configured. Both the video
 * storage and AI setup sections read the same three stores, so the settings
 * page resolves this once and hands it to each of them.
 */
export function useSecretStatus(): SecretStatus {
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [last4, setLast4] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [envRes, secretsRes, adhocRes] = await Promise.all([
        fetch(agentNativePath("/_agent-native/env-status")),
        fetch(agentNativePath("/_agent-native/secrets")),
        fetch(agentNativePath("/_agent-native/secrets/adhoc")),
      ]);
      const envData = envRes.ok
        ? ((await envRes.json()) as Array<{
            key: string;
            configured?: boolean;
          }>)
        : [];
      const secretsData = secretsRes.ok
        ? ((await secretsRes.json()) as Array<{ key: string; status?: string }>)
        : [];
      const adhocData = adhocRes.ok
        ? ((await adhocRes.json()) as Array<{ name: string; last4?: string }>)
        : [];

      const next = Object.fromEntries(
        envData.map((entry) => [entry.key, Boolean(entry.configured)]),
      );
      for (const entry of secretsData) {
        next[entry.key] = entry.status === "set";
      }
      const nextLast4: Record<string, string> = {};
      for (const entry of adhocData) {
        next[entry.name] = true;
        if (entry.last4) nextLast4[entry.name] = entry.last4;
      }
      setLast4(nextLast4);
      setConfigured(next);
    } catch {
      setConfigured({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { configured, last4, loading, refresh };
}
