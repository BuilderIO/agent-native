import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentNativePath, useChangeVersions } from "@agent-native/core/client";
import { appApiPath } from "@/lib/api-path";

// ─── Generic integration credentials (via application-state) ────────────────

type Provider = "apollo" | "hubspot" | "gong" | "pylon";

function useIntegrationStatus(provider: Provider) {
  // Refetch on any app-state write or agent action — covers both the local
  // connect/disconnect mutations and agent-driven changes to the provider's
  // application-state row. See `use-change-version.ts` in @agent-native/core.
  const sync = useChangeVersions(["app-state", "action"]);
  const { data } = useQuery<{ apiKey?: string } | null>({
    queryKey: ["integration-status", provider, sync],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(`/_agent-native/application-state/${provider}`),
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  return !!data?.apiKey;
}

function useIntegrationConnect(provider: Provider) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (apiKey: string) => {
      const res = await fetch(
        agentNativePath(`/_agent-native/application-state/${provider}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey }),
        },
      );
      if (!res.ok) throw new Error(`${res.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integration-status", provider] });
      qc.invalidateQueries({ queryKey: ["integration-data", provider] });
    },
  });
}

function useIntegrationDisconnect(provider: Provider) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch(
        agentNativePath(`/_agent-native/application-state/${provider}`),
        {
          method: "DELETE",
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integration-status", provider] });
      qc.invalidateQueries({ queryKey: ["integration-data", provider] });
    },
  });
}

// ─── Provider-specific data fetching ────────────────────────────────────────

export function useAllIntegrations() {
  const apollo = useIntegrationStatus("apollo");
  const hubspot = useIntegrationStatus("hubspot");
  const gong = useIntegrationStatus("gong");
  const pylon = useIntegrationStatus("pylon");
  return { apollo, hubspot, gong, pylon };
}

export function useIntegration(provider: Provider) {
  const connected = useIntegrationStatus(provider);
  const connect = useIntegrationConnect(provider);
  const disconnect = useIntegrationDisconnect(provider);
  return { connected, connect, disconnect };
}

export function useHubSpotContact(email: string | undefined) {
  const connected = useIntegrationStatus("hubspot");
  return useQuery({
    queryKey: ["integration-data", "hubspot", email],
    queryFn: async () => {
      const res = await fetch(
        appApiPath(`/api/hubspot/contact?email=${encodeURIComponent(email!)}`),
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!email && connected,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function usePylonContact(email: string | undefined) {
  const connected = useIntegrationStatus("pylon");
  return useQuery({
    queryKey: ["integration-data", "pylon", email],
    queryFn: async () => {
      const res = await fetch(
        appApiPath(`/api/pylon/contact?email=${encodeURIComponent(email!)}`),
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!email && connected,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useGongCalls(email: string | undefined) {
  const connected = useIntegrationStatus("gong");
  return useQuery({
    queryKey: ["integration-data", "gong", email],
    queryFn: async () => {
      const res = await fetch(
        appApiPath(`/api/gong/calls?email=${encodeURIComponent(email!)}`),
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!email && connected,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
