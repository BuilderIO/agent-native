import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  OrgInfo,
  OrgMember,
  OrgPendingInvitation,
} from "../../org/types.js";

const ORG_BASE = "/_agent-native/org";

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // Prefer a JSON `error` / `message` field when the server returns one,
    // and only fall back to the raw body for plaintext responses. Avoids
    // surfacing `{"error":"..."}` as the user-visible message.
    const text = await res.text().catch(() => "");
    let message: string = res.statusText;
    if (text) {
      try {
        const parsed = JSON.parse(text) as {
          error?: string;
          message?: string;
        };
        message = parsed.error ?? parsed.message ?? text;
      } catch {
        message = text;
      }
    }
    throw new Error(message);
  }
  return res.json();
}

export function useOrg() {
  return useQuery<OrgInfo>({
    queryKey: ["org-me"],
    queryFn: () => apiFetch(`${ORG_BASE}/me`),
    staleTime: 30_000,
  });
}

export function useOrgMembers() {
  return useQuery<{ members: OrgMember[] }>({
    queryKey: ["org-members"],
    queryFn: () => apiFetch(`${ORG_BASE}/members`),
    staleTime: 30_000,
  });
}

export function useOrgInvitations() {
  return useQuery<{ invitations: OrgPendingInvitation[] }>({
    queryKey: ["org-invitations"],
    queryFn: () => apiFetch(`${ORG_BASE}/invitations`),
    staleTime: 30_000,
  });
}

// NOTE: the onSuccess handlers below `await invalidateQueries`. In
// TanStack Query v5, invalidateQueries:
//   1. Marks every matching query as stale, so the next mount of an
//      INACTIVE query (e.g. the org-members table on a settings page
//      the user hasn't visited yet) refetches immediately instead of
//      serving 30-second-stale cached data.
//   2. Triggers a refetch of every ACTIVE query that matches.
//   3. Returns a promise that resolves once those refetches settle.
//
// `await`ing therefore keeps `mutation.isPending` true through the
// full read-after-write window — closing the create-org / accept-
// invite race where a button could re-enable mid-refetch. We
// previously tried refetchQueries here for "unambiguous semantics",
// but that variant doesn't mark inactive queries stale, leaving them
// to serve stale data on next mount. invalidateQueries is the right
// primitive — it just needed an `await`.

export function useCreateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch(ORG_BASE, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["org-me"] }),
        qc.invalidateQueries({ queryKey: ["org-members"] }),
      ]);
    },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch(`${ORG_BASE}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["org-members"] }),
        qc.invalidateQueries({ queryKey: ["org-invitations"] }),
      ]);
    },
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      apiFetch(`${ORG_BASE}/invitations/${invitationId}/accept`, {
        method: "POST",
      }),
    onSuccess: async () => {
      // Joining/switching orgs changes all org-scoped data — invalidate
      // every cached query (no key filter) so each one refetches or is
      // marked stale for the next mount.
      await qc.invalidateQueries();
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch(`${ORG_BASE}/members/${encodeURIComponent(email)}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-members"] });
    },
  });
}

export function useUpdateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch(ORG_BASE, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-me"] });
    },
  });
}

export function useSwitchOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string | null) =>
      apiFetch(`${ORG_BASE}/switch`, {
        method: "PUT",
        body: JSON.stringify({ orgId }),
      }),
    onSuccess: async () => {
      // Switching org changes everything scoped to AGENT_ORG_ID.
      await qc.invalidateQueries();
    },
  });
}

export function useJoinByDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) =>
      apiFetch(`${ORG_BASE}/join-by-domain`, {
        method: "POST",
        body: JSON.stringify({ orgId }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries();
    },
  });
}

export function useSetOrgDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domain: string | null) =>
      apiFetch(`${ORG_BASE}/domain`, {
        method: "PUT",
        body: JSON.stringify({ domain }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-me"] });
    },
  });
}
