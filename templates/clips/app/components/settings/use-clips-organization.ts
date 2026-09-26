import {
  useActionMutation,
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg, useOrgRole } from "@agent-native/core/client/org";
import type { ClipsDefaultVisibility } from "@shared/clips-ai-prefs";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import type { MemberRole } from "@/components/workspace/members-list";

const ORGANIZATION_STATE_ACTION = "list-organization-state";

export interface ClipsOrganizationBranding {
  id: string;
  name: string;
  brandColor: string;
  brandLogoUrl: string | null;
  defaultVisibility: ClipsDefaultVisibility;
  ownerEmail?: string;
}

interface OrganizationStateResponse {
  organization: ClipsOrganizationBranding | null;
  members: { email: string; role: MemberRole }[];
}

export type ClipsBrandingPatch = Partial<
  Pick<
    ClipsOrganizationBranding,
    "brandColor" | "brandLogoUrl" | "defaultVisibility"
  >
>;

/**
 * The active organization's Clips branding and whether the viewer may edit
 * it. `organization` is null only once the org is known to have none; a
 * failed read is `isError`, never an empty organization.
 */
export function useClipsOrganization() {
  const { session } = useSession();
  const email = session?.email ?? "";
  const orgQuery = useOrg();
  const activeOrgId = orgQuery.data?.orgId ?? null;
  // Scoped per org so a switch never seeds the next org with this one's
  // cached branding.
  const stateQuery = useActionQuery<OrganizationStateResponse>(
    ORGANIZATION_STATE_ACTION,
    activeOrgId ? { organizationId: activeOrgId } : undefined,
    { enabled: Boolean(activeOrgId) },
  );
  const organization = stateQuery.data?.organization ?? null;
  const members = stateQuery.data?.members;
  const isAdmin = useMemo(() => {
    if (organization?.ownerEmail && organization.ownerEmail === email) {
      return true;
    }
    const role = members?.find((member) => member.email === email)?.role;
    return role === "admin" || role === "owner";
  }, [email, members, organization?.ownerEmail]);

  return {
    activeOrgId,
    /** False once the viewer is known to have no active organization. */
    hasOrganization: orgQuery.data ? Boolean(activeOrgId) : undefined,
    organization,
    isAdmin,
    isLoading:
      orgQuery.isLoading || (Boolean(activeOrgId) && stateQuery.isPending),
    isError: orgQuery.isError || stateQuery.isError,
    refetch: () => {
      void orgQuery.refetch();
      void stateQuery.refetch();
    },
  };
}

/**
 * Saves branding fields at once: the change shows before the server answers
 * and rolls back with an error toast if the save fails.
 */
export function useSaveClipsBranding(organizationId: string | null) {
  const t = useT();
  const queryClient = useQueryClient();
  const { mutate } = useActionMutation<
    unknown,
    ClipsBrandingPatch & { organizationId: string }
  >("set-organization-branding");
  return useCallback(
    (patch: ClipsBrandingPatch) => {
      if (!organizationId) return;
      const filter = { queryKey: ["action", ORGANIZATION_STATE_ACTION] };
      const previous =
        queryClient.getQueriesData<OrganizationStateResponse>(filter);
      queryClient.setQueriesData<OrganizationStateResponse>(filter, (current) =>
        current?.organization?.id === organizationId
          ? {
              ...current,
              organization: { ...current.organization, ...patch },
            }
          : current,
      );
      mutate(
        { organizationId, ...patch },
        {
          onError: (error) => {
            for (const [key, value] of previous) {
              queryClient.setQueryData(key, value);
            }
            toast.error(error.message || t("brandingEditor.saveFailed"));
          },
        },
      );
    },
    [mutate, organizationId, queryClient, t],
  );
}

/**
 * Owners and admins manage workspace-wide setup. Someone with no
 * organization owns their own setup, the same rule the Settings shell uses.
 */
export function useCanManageClipsWorkspace(): boolean {
  const { org, canManageOrg } = useOrgRole();
  return canManageOrg || (org !== undefined && !org.orgId);
}
