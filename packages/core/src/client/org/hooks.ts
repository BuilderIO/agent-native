import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { IconValue } from "../../icons/index.js";
import {
  canInviteOrgMembers,
  canManageOrg,
  canManageOrgDomain,
} from "../../org/permissions.js";
import type {
  OrgInfo,
  OrgMember,
  OrgPendingInvitation,
  OrgRole,
} from "../../org/types.js";
import { agentNativePath } from "../api-path.js";
import { useActionMutation, useActionQuery } from "../use-action.js";

const ORG_BASE = agentNativePath("/_agent-native/org");

async function apiFetch(path: string, init?: RequestInit) {
  const headers = new Headers({ "Content-Type": "application/json" });
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
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

export function useOrg(options: { enabled?: boolean } = {}) {
  return useQuery<OrgInfo>({
    queryKey: ["org-me"],
    queryFn: () => apiFetch(`${ORG_BASE}/me`),
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  });
}

export interface UseOrgRoleResult {
  org: OrgInfo | undefined;
  role: OrgRole | null;
  isOwner: boolean;
  canManageOrg: boolean;
  canInviteMembers: boolean;
  canManageDomain: boolean;
  isLoading: boolean;
  error: Error | null;
}

export function useOrgRole(): UseOrgRoleResult {
  const query = useOrg();
  const role = query.data?.role ?? null;
  return {
    org: query.data,
    role,
    isOwner: role === "owner",
    canManageOrg: canManageOrg(role),
    canInviteMembers: canInviteOrgMembers(role, query.data?.emailConfigured),
    canManageDomain: canManageOrgDomain(role),
    isLoading: query.isLoading,
    error: query.error,
  };
}

export const ORG_MEMBER_PAGE_SIZE = 25;

export interface OrgMembersPage {
  members: OrgMember[];
  totalCount: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export function useOrgMembers(offset = 0, query = "") {
  const { data: org } = useOrg();
  const search = query.trim().toLowerCase();
  const params = new URLSearchParams({
    limit: String(ORG_MEMBER_PAGE_SIZE),
    offset: String(offset),
  });
  if (search) params.set("search", search);
  return useQuery<OrgMembersPage>({
    queryKey: ["org-members", org?.orgId ?? null, offset, search],
    queryFn: ({ signal }) =>
      apiFetch(`${ORG_BASE}/members?${params}`, { signal }),
    enabled: Boolean(org?.orgId),
    staleTime: 30_000,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === org?.orgId &&
      previousQuery?.queryKey[3] === search
        ? previousData
        : undefined,
  });
}

export function useOrgInvitations() {
  const { data: org } = useOrg();
  return useQuery<{ invitations: OrgPendingInvitation[] }>({
    queryKey: ["org-invitations", org?.orgId ?? null],
    queryFn: () => apiFetch(`${ORG_BASE}/invitations`),
    staleTime: 30_000,
  });
}


export function useCreateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch(ORG_BASE, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries();
    },
  });
}

export type InviteRole = "admin" | "member";

export interface InviteVars {
  email: string;
  role?: InviteRole;
  appId?: string;
  appRoles?: string[];
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: string | InviteVars) => {
      const body: {
        email: string;
        role: InviteRole;
        appId?: string;
        appRoles?: string[];
      } =
        typeof vars === "string"
          ? { email: vars, role: "member" }
          : {
              email: vars.email,
              role: vars.role ?? "member",
              appId: vars.appId,
              appRoles: vars.appRoles,
            };
      return apiFetch(`${ORG_BASE}/invitations`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["org-members"] }),
        qc.invalidateQueries({ queryKey: ["org-invitations"] }),
      ]);
    },
  });
}

export interface BulkInviteResult {
  succeeded: Array<{
    id: string;
    email: string;
    role: InviteRole;
    status: "pending";
    emailSent: boolean;
    emailError?: string;
  }>;
  failed: Array<{ email: string; error: string }>;
  total: number;
}

export function useBulkInviteMembers() {
  const qc = useQueryClient();
  return useMutation<BulkInviteResult, Error, InviteVars[]>({
    mutationFn: (invites) =>
      apiFetch(`${ORG_BASE}/invitations`, {
        method: "POST",
        body: JSON.stringify({
          invites: invites.map((i) => ({
            email: i.email,
            role: i.role ?? "member",
            appId: i.appId,
            appRoles: i.appRoles,
          })),
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["org-members"] }),
        qc.invalidateQueries({ queryKey: ["org-invitations"] }),
      ]);
    },
  });
}

export function useChangeMemberRole() {
  const qc = useQueryClient();
  return useMutation<
    { email: string; role: InviteRole },
    Error,
    { email: string; role: InviteRole }
  >({
    mutationFn: ({ email, role }) =>
      apiFetch(`${ORG_BASE}/members/${encodeURIComponent(email)}/role`, {
        method: "PUT",
        body: JSON.stringify({ role }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-members"] });
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
      await qc.invalidateQueries();
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      email,
      transferTo,
    }: {
      email: string;
      transferTo: string;
    }) =>
      apiFetch(`${ORG_BASE}/members/${encodeURIComponent(email)}`, {
        method: "DELETE",
        body: JSON.stringify({ transferTo }),
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

export function useSetOrgVisualIdentity() {
  const qc = useQueryClient();
  return useMutation<
    {
      orgId: string;
      icon: IconValue | null;
      iconRevision: number;
      syncPending: boolean;
    },
    Error,
    IconValue | null,
    { previous: OrgInfo | undefined }
  >({
    mutationFn: (icon) =>
      apiFetch(`${ORG_BASE}/visual-identity`, {
        method: "PUT",
        body: JSON.stringify({ icon }),
      }),
    onMutate: async (icon) => {
      await qc.cancelQueries({ queryKey: ["org-me"] });
      const previous = qc.getQueryData<OrgInfo>(["org-me"]);
      if (previous) {
        qc.setQueryData<OrgInfo>(["org-me"], {
          ...previous,
          icon,
          orgs: previous.orgs.map((organization) =>
            organization.orgId === previous.orgId
              ? { ...organization, icon }
              : organization,
          ),
        });
      }
      return { previous };
    },
    onError: (_error, _icon, context) => {
      if (context?.previous) qc.setQueryData(["org-me"], context.previous);
      void qc.invalidateQueries({ queryKey: ["org-me"] });
    },
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
      await qc.invalidateQueries();
    },
  });
}

export function useDeleteOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch(ORG_BASE, {
        method: "DELETE",
        body: JSON.stringify({ name }),
      }),
    onSuccess: async () => {
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

export type WorkspaceAppDefaultVisibility = "private" | "org";

export function useSetWorkspaceAppDefaultVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (visibility: WorkspaceAppDefaultVisibility) =>
      apiFetch(`${ORG_BASE}/workspace-app-default-visibility`, {
        method: "PUT",
        body: JSON.stringify({ visibility }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-me"] });
    },
  });
}

export type WorkspaceAppAccessMode = "all" | "restricted" | "disabled";

export interface WorkspaceAppAccess {
  id: string;
  name: string;
  description: string | null;
  path: string;
  mode: WorkspaceAppAccessMode;
}

export function useWorkspaceAppAccess(options: { enabled?: boolean } = {}) {
  return useActionQuery<{ apps: WorkspaceAppAccess[] }>(
    "list-workspace-app-access",
    {},
    { enabled: options.enabled ?? true },
  );
}

export function useSetWorkspaceAppAccess() {
  const qc = useQueryClient();
  return useActionMutation("set-workspace-app-access", {
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["action", "list-workspace-app-access"],
      });
    },
  });
}

export function useSetOrgWorkspaceUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string | null) =>
      apiFetch(`${ORG_BASE}/workspace-url`, {
        method: "PUT",
        body: JSON.stringify({ url }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-me"] });
    },
  });
}

export function useSetOrgAuthProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: "google" | `sso:${string}` | null) =>
      apiFetch(`${ORG_BASE}/auth-provider`, {
        method: "PUT",
        body: JSON.stringify({ provider }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-me"] });
    },
  });
}

export interface OrgSsoProvider {
  providerId: string;
  issuer: string;
  domain: string;
  domainVerified: boolean;
  type: "oidc" | "saml";
  redirectURI: string;
  spMetadataUrl: string;
}

export interface OrgSsoProvidersResult {
  enabled: boolean;
  providers: OrgSsoProvider[];
}

export interface OrgScimConnection {
  connectionId: string;
  status: string;
  createdAt: string | number;
}

export interface OrgScimResult {
  enabled: boolean;
  endpoint: string;
  connections: OrgScimConnection[];
}

export function useOrgSsoProviders(enabled = true) {
  const { data: org } = useOrg();
  return useQuery<OrgSsoProvidersResult>({
    queryKey: ["org-sso-providers", org?.orgId ?? null],
    queryFn: () => apiFetch(`${ORG_BASE}/sso/providers`),
    enabled: Boolean(org?.orgId) && enabled,
  });
}

export function useCreateOrgSsoProvider() {
  const qc = useQueryClient();
  return useMutation<
    { provider: OrgSsoProvider; domainVerificationToken?: string },
    Error,
    {
      providerId: string;
      issuer: string;
      domain: string;
      type: "oidc" | "saml";
      oidcConfig?: {
        clientId: string;
        clientSecret: string;
        discoveryEndpoint?: string;
      };
      samlConfig?: {
        entryPoint: string;
        cert?: string;
        idpMetadata: { entityID: string; metadata: string };
      };
    }
  >({
    mutationFn: (body: {
      providerId: string;
      issuer: string;
      domain: string;
      type: "oidc" | "saml";
      oidcConfig?: {
        clientId: string;
        clientSecret: string;
        discoveryEndpoint?: string;
      };
      samlConfig?: {
        entryPoint: string;
        cert?: string;
        idpMetadata: { entityID: string; metadata: string };
      };
    }) =>
      apiFetch(`${ORG_BASE}/sso/providers`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-sso-providers"] });
    },
  });
}

export function useVerifyOrgSsoProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) =>
      apiFetch(
        `${ORG_BASE}/sso/providers/${encodeURIComponent(providerId)}/verify`,
        { method: "POST" },
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-sso-providers"] });
    },
  });
}

export function useDeleteOrgSsoProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) =>
      apiFetch(`${ORG_BASE}/sso/providers/${encodeURIComponent(providerId)}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["org-sso-providers"] }),
        qc.invalidateQueries({ queryKey: ["org-me"] }),
      ]);
    },
  });
}

export function useOrgScim(enabled = true) {
  const { data: org } = useOrg();
  return useQuery<OrgScimResult>({
    queryKey: ["org-scim", org?.orgId ?? null],
    queryFn: () => apiFetch(`${ORG_BASE}/scim`),
    enabled: Boolean(org?.orgId) && enabled,
  });
}

export function useCreateOrgScimConnection() {
  const qc = useQueryClient();
  return useMutation<
    { connection: OrgScimConnection; token: string },
    Error,
    void
  >({
    mutationFn: () =>
      apiFetch(`${ORG_BASE}/scim`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-scim"] });
    },
  });
}

export function useDeleteOrgScimConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) =>
      apiFetch(`${ORG_BASE}/scim/${encodeURIComponent(connectionId)}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-scim"] });
    },
  });
}

export interface AppRoleAssignment {
  email: string;
  roles: string[];
  /** @deprecated Read `roles`; retained for one minor release for clients upgrading from the single-role API. */
  role: string | null;
}

export interface AppRolesInfo {
  appId: string;
  roles: string[];
  permissions: Record<string, readonly string[]>;
  permissionLabels?: Record<string, string>;
  defaultRole: string | null;
  roleLabels: Record<string, string>;
  canManage: boolean;
  assignments: AppRoleAssignment[];
  myRoles: string[];
  /** @deprecated Read `myRoles`; retained for one minor release. */
  myRole: string | null;
}

export function useAppRoles(appId: string | undefined) {
  const { data: org } = useOrg();
  return useQuery<AppRolesInfo>({
    queryKey: ["org-app-roles", appId ?? null, org?.orgId ?? null],
    queryFn: () =>
      apiFetch(`${ORG_BASE}/app-roles?appId=${encodeURIComponent(appId!)}`),
    enabled: Boolean(appId),
    staleTime: 30_000,
  });
}

export interface AppPermissionsInfo {
  appId: string;
  permissions: Record<
    string,
    { defaults: string[]; roles: string[]; overridden: boolean }
  >;
  roles: string[];
  can: (permission: string) => boolean;
}

export function useAppPermissions(appId: string | undefined) {
  const roles = useAppRoles(appId);
  const permissions = useActionQuery(
    "list-app-permissions",
    { appId: appId ?? "" },
    { enabled: Boolean(appId) },
  );
  const grants =
    (
      permissions.data as
        | { permissions?: AppPermissionsInfo["permissions"] }
        | undefined
    )?.permissions ?? {};
  const myRoles = roles.data?.myRoles ?? [];
  return {
    appId: appId ?? "",
    permissions: grants,
    roles: myRoles,
    can: (permission: string) =>
      (grants[permission]?.roles ?? []).some((role) => myRoles.includes(role)),
    isLoading: roles.isLoading || permissions.isLoading,
    error: roles.error ?? permissions.error ?? null,
  };
}

export function RequirePermission({
  appId,
  permission,
  children,
  fallback = null,
}: {
  appId: string | undefined;
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const access = useAppPermissions(appId);
  return access.can(permission) ? children : fallback;
}

export function useAppRole(appId: string | undefined): {
  roles: string[];
  /** @deprecated Read `roles`; retained for one minor release. */
  role: string | null;
  isLoading: boolean;
  error: Error | null;
} {
  const query = useAppRoles(appId);
  return {
    roles: query.data?.myRoles ?? [],
    role: query.data?.myRole ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}

export function useSetAppMemberRoles() {
  const qc = useQueryClient();
  return useActionMutation("set-app-member-roles", {
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-app-roles"] });
    },
  });
}

/**
 * @deprecated Use `useSetAppMemberRoles`. This adapter keeps existing generated
 * apps source-compatible while they migrate from one role to an array.
 */
export function useSetAppMemberRole(appId: string) {
  const modern = useSetAppMemberRoles();
  return useMutation<
    { appId: string; email: string; role: string | null },
    Error,
    { email: string; role: string | null }
  >({
    mutationFn: async ({ email, role }) => {
      await modern.mutateAsync({
        appId,
        email,
        roles: role ? [role] : [],
      });
      return { appId, email, role };
    },
  });
}

/**
 * Fetch the org's A2A secret on demand (owner/admin). Deliberately a separate
 * request from `useOrg()` so the secret only reaches the browser when the
 * operator asks to reveal or copy it.
 */
export function useRevealA2ASecret() {
  return useMutation<{ a2aSecret: string | null }, Error, void>({
    mutationFn: () => apiFetch(`${ORG_BASE}/a2a-secret`),
  });
}

export function useSetA2ASecret() {
  const qc = useQueryClient();
  return useMutation<
    { a2aSecret: string; previousSecret: string | null },
    Error,
    string | undefined
  >({
    mutationFn: (secret?: string) =>
      apiFetch(`${ORG_BASE}/a2a-secret`, {
        method: "PUT",
        body: JSON.stringify({ secret }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-me"] });
    },
  });
}

export interface SyncA2ASecretResult {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    id: string;
    name: string;
    url: string;
    ok: boolean;
    status?: number;
    error?: string;
  }>;
}

export function useSyncA2ASecret() {
  return useMutation<
    SyncA2ASecretResult,
    Error,
    { signSecret?: string } | void
  >({
    mutationFn: (vars) =>
      apiFetch(`${ORG_BASE}/a2a-secret/sync`, {
        method: "POST",
        body: JSON.stringify({
          signSecret:
            vars && "signSecret" in vars ? vars.signSecret : undefined,
        }),
      }),
  });
}
