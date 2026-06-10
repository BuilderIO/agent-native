import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";
import { appApiPath } from "@agent-native/core/client";

// ─── Generic integration credentials (via application-state) ────────────────

type Provider = "apollo" | "hubspot" | "gong" | "pylon";

function useIntegrationStatus(provider: Provider) {
  const { data } = useQuery<{ apiKey?: string } | null>({
    queryKey: ["integration-status", provider],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(`/_agent-native/application-state/${provider}`),
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
  return !!data?.apiKey;
}

export class IntegrationConnectError extends Error {
  constructor(
    message: string,
    public readonly kind: "invalid-key" | "unreachable" | "save-failed",
  ) {
    super(message);
    this.name = "IntegrationConnectError";
  }
}

function useIntegrationConnect(provider: Provider) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (apiKey: string) => {
      // Verify the key against the upstream provider before persisting it,
      // so the user sees a real error instead of a key that silently fails
      // the next time they open a contact.
      const validateRes = await fetch(appApiPath(`/api/${provider}/validate`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      if (!validateRes.ok) {
        const data: { error?: string } = await validateRes
          .json()
          .catch(() => ({}));
        const kind =
          validateRes.status === 401 || validateRes.status === 403
            ? "invalid-key"
            : "unreachable";
        throw new IntegrationConnectError(
          data.error ||
            (kind === "invalid-key"
              ? "Invalid API key."
              : "Could not reach the provider to verify the key."),
          kind,
        );
      }
      const saveRes = await fetch(
        agentNativePath(`/_agent-native/application-state/${provider}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey }),
        },
      );
      if (!saveRes.ok) {
        throw new IntegrationConnectError(
          "Could not save the API key.",
          "save-failed",
        );
      }
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

async function integrationFetch<T>(url: string): Promise<T> {
  const res = await fetch(appApiPath(url));
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export function useHubSpotContact(email: string | undefined) {
  const connected = useIntegrationStatus("hubspot");
  return useQuery({
    queryKey: ["integration-data", "hubspot", email],
    queryFn: () =>
      integrationFetch(
        `/api/hubspot/contact?email=${encodeURIComponent(email!)}`,
      ),
    enabled: !!email && connected,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function usePylonContact(email: string | undefined) {
  const connected = useIntegrationStatus("pylon");
  return useQuery({
    queryKey: ["integration-data", "pylon", email],
    queryFn: () =>
      integrationFetch(
        `/api/pylon/contact?email=${encodeURIComponent(email!)}`,
      ),
    enabled: !!email && connected,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useGongCalls(email: string | undefined) {
  const connected = useIntegrationStatus("gong");
  return useQuery({
    queryKey: ["integration-data", "gong", email],
    queryFn: () =>
      integrationFetch(`/api/gong/calls?email=${encodeURIComponent(email!)}`),
    enabled: !!email && connected,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/** Check if a React Query error is an auth/key error */
export function isAuthError(error: Error | null | unknown): boolean {
  if (!error || !(error instanceof Error)) return false;
  return error.message === "unauthorized" || error.message === "401";
}
