import { useChangeVersions } from "@agent-native/core/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { appApiPath } from "@/lib/api-path";

// ─── Generic integration credentials (via encrypted per-user vault) ──────────
//
// SECURITY: The raw API key is NEVER sent to the browser. The status endpoint
// returns only `{ connected }`; the secret is stored server-side in the
// encrypted credentials vault, scoped to the requesting user.

type Provider = "apollo" | "hubspot" | "gong" | "pylon";

function useIntegrationStatus(provider: Provider) {
  // Refetch on any agent action — covers agent-driven connect/disconnect that
  // writes the credential server-side. See `use-change-version.ts` in
  // @agent-native/core.
  const sync = useChangeVersions(["action"]);
  const { data } = useQuery<{ connected: boolean } | null>({
    queryKey: ["integration-status", provider, sync],
    queryFn: async () => {
      const res = await fetch(appApiPath(`/api/${provider}/status`));
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  return !!data?.connected;
}

function useIntegrationConnect(provider: Provider) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (apiKey: string) => {
      const res = await fetch(appApiPath(`/api/${provider}/key`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
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
      await fetch(appApiPath(`/api/${provider}/key`), {
        method: "DELETE",
      });
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
