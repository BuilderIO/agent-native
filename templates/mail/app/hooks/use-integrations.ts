import {
  appApiPath,
  callAction,
  deleteClientAppState,
  writeClientAppState,
} from "@agent-native/core/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  EMPTY_MAIL_INTEGRATION_STATUSES,
  MAIL_INTEGRATION_STATUS_QUERY_KEY,
  type MailIntegrationProvider,
  type MailIntegrationStatuses,
} from "@/lib/integration-status";
import { TAB_ID } from "@/lib/tab-id";

// ─── Generic integration credentials (via application-state) ────────────────

function useIntegrationStatuses() {
  return useQuery<MailIntegrationStatuses>({
    queryKey: MAIL_INTEGRATION_STATUS_QUERY_KEY,
    queryFn: ({ signal }) =>
      callAction<MailIntegrationStatuses>(
        "get-integration-statuses",
        {},
        { method: "GET", signal },
      ),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

function useIntegrationStatus(provider: MailIntegrationProvider) {
  const { data } = useIntegrationStatuses();
  return data?.[provider] ?? false;
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

function useIntegrationConnect(provider: MailIntegrationProvider) {
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
      try {
        await writeClientAppState(
          provider,
          { apiKey },
          { requestSource: TAB_ID },
        );
      } catch {
        throw new IntegrationConnectError(
          "Could not save the API key.",
          "save-failed",
        );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MAIL_INTEGRATION_STATUS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["integration-data", provider] });
    },
  });
}

function useIntegrationDisconnect(provider: MailIntegrationProvider) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await deleteClientAppState(provider, { requestSource: TAB_ID });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MAIL_INTEGRATION_STATUS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["integration-data", provider] });
    },
  });
}

// ─── Provider-specific data fetching ────────────────────────────────────────

export function useAllIntegrations() {
  const { data } = useIntegrationStatuses();
  return data ?? EMPTY_MAIL_INTEGRATION_STATUSES;
}

export function useIntegration(provider: MailIntegrationProvider) {
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
  return useQuery({
    queryKey: ["integration-data", "hubspot", email],
    queryFn: () =>
      integrationFetch(
        `/api/hubspot/contact?email=${encodeURIComponent(email!)}`,
      ),
    enabled: !!email,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function usePylonContact(email: string | undefined) {
  return useQuery({
    queryKey: ["integration-data", "pylon", email],
    queryFn: () =>
      integrationFetch(
        `/api/pylon/contact?email=${encodeURIComponent(email!)}`,
      ),
    enabled: !!email,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useGongCalls(email: string | undefined) {
  return useQuery({
    queryKey: ["integration-data", "gong", email],
    queryFn: () =>
      integrationFetch(`/api/gong/calls?email=${encodeURIComponent(email!)}`),
    enabled: !!email,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Check if a React Query error is an auth/key error */
export function isAuthError(error: Error | null | unknown): boolean {
  if (!error || !(error instanceof Error)) return false;
  return error.message === "unauthorized" || error.message === "401";
}
