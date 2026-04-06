import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TAB_ID } from "@/lib/tab-id";

function apiFetch(path: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
      ...init?.headers,
    },
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(body || res.statusText);
    }
    return res.json();
  });
}

export type OrgSummary = {
  orgId: string;
  orgName: string;
  role: string;
};

export type OrgInfo = {
  email: string;
  orgId: string | null;
  orgName: string | null;
  role: "owner" | "admin" | "member" | null;
  orgs: OrgSummary[];
  pendingInvitations: {
    id: string;
    orgId: string;
    orgName: string;
    invitedBy: string;
  }[];
};

export type OrgMember = {
  email: string;
  role: string;
  joinedAt: number;
};

export function useOrg() {
  return useQuery<OrgInfo>({
    queryKey: ["org-me"],
    queryFn: () => apiFetch("/api/org/me"),
    staleTime: 30_000,
  });
}

export function useOrgMembers() {
  return useQuery<{ members: OrgMember[] }>({
    queryKey: ["org-members"],
    queryFn: () => apiFetch("/api/org/members"),
    staleTime: 30_000,
  });
}

export function useCreateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch("/api/org", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-me"] });
      qc.invalidateQueries({ queryKey: ["org-members"] });
      qc.invalidateQueries({ queryKey: ["greenhouse-status"] });
    },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch("/api/org/invitations", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-members"] });
      qc.invalidateQueries({ queryKey: ["org-invitations"] });
    },
  });
}

export function useOrgInvitations() {
  return useQuery<{
    invitations: {
      id: string;
      email: string;
      invitedBy: string;
      createdAt: number;
      status: string;
    }[];
  }>({
    queryKey: ["org-invitations"],
    queryFn: () => apiFetch("/api/org/invitations"),
    staleTime: 30_000,
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      apiFetch(`/api/org/invitations/${invitationId}/accept`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-me"] });
      qc.invalidateQueries({ queryKey: ["org-members"] });
      qc.invalidateQueries({ queryKey: ["greenhouse-status"] });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch(`/api/org/members/${encodeURIComponent(email)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-members"] });
    },
  });
}

export function useSwitchOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string | null) =>
      apiFetch("/api/org/switch", {
        method: "PUT",
        body: JSON.stringify({ orgId }),
      }),
    onSuccess: () => {
      // Switching org changes everything — clear all cached data
      qc.invalidateQueries();
    },
  });
}
