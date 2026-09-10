import { useActionQuery, useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BrandingEditor,
  type RecordingVisibility,
} from "@/components/workspace/branding-editor";
import type { MemberRole } from "@/components/workspace/members-list";

interface OrganizationStateResponse {
  organization: {
    id: string;
    name: string;
    brandColor: string;
    brandLogoUrl: string | null;
    defaultVisibility: RecordingVisibility;
    ownerEmail?: string;
  } | null;
  members: { email: string; role: MemberRole }[];
}

/**
 * Organization identity — name, logo, brand color, default recording
 * visibility. It sits directly above membership in the Organization tab
 * because the name and logo are what recipients see in share emails.
 */
export function OrganizationIdentityCard() {
  const t = useT();
  const { session } = useSession();
  const email = session?.email ?? "";
  const {
    data: orgInfo,
    isLoading: orgLoading,
    isError: isOrgError,
  } = useOrg();
  // Personal scope owns this surface: the framework Team card below already
  // renders "create an organization", so an org-scoped branding fetch here
  // has nothing to read and its failure reads as a broken page. A failed org
  // lookup also leaves `orgInfo` undefined, so it must stay distinguishable
  // from a loaded `orgId: null` instead of silently hiding the section.
  const activeOrgId = orgInfo?.orgId ?? null;
  const hasActiveOrg = Boolean(activeOrgId);

  // Scope the request - and therefore the query key - to the active org.
  // An unscoped key hands the next organization the previous one's cached
  // branding while it refetches, which `BrandingEditor` would then seed its
  // form with and save back under the new org's id.
  const { data, isPending, isError } =
    useActionQuery<OrganizationStateResponse>(
      "list-organization-state",
      activeOrgId ? { organizationId: activeOrgId } : undefined,
      { enabled: hasActiveOrg },
    );

  const organization = data?.organization ?? null;
  const members = useMemo(() => data?.members ?? [], [data?.members]);
  const isAdmin = useMemo(() => {
    if (organization?.ownerEmail && organization.ownerEmail === email) {
      return true;
    }
    const role = members.find((m) => m.email === email)?.role;
    return role === "admin" || role === "owner";
  }, [members, email, organization?.ownerEmail]);

  // A failed load must not look like "this org has no branding", and an
  // unreadable organization must not look like not having one.
  if (isOrgError || isError) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {t("organizationSettings.brandingLoadFailed")}
        </CardContent>
      </Card>
    );
  }
  if (orgLoading) return <Skeleton className="h-64 w-full" />;
  if (!hasActiveOrg) return null;
  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (!organization) return null;

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("brandingEditor.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            {organization.brandLogoUrl ? (
              <img
                src={organization.brandLogoUrl}
                alt=""
                className="h-10 w-10 rounded object-contain"
              />
            ) : (
              <div
                className="h-10 w-10 rounded"
                style={{ background: organization.brandColor }}
              />
            )}
            <div>
              <div className="font-medium">{organization.name}</div>
              <div className="text-xs text-muted-foreground">
                {t("organizationSettings.adminsOnlyBranding")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    // Remount per organization: the editor seeds its form state from these
    // props once, so a reused instance keeps the previous org's values.
    <BrandingEditor
      key={organization.id}
      organizationId={organization.id}
      initialName={organization.name}
      initialBrandColor={organization.brandColor}
      initialBrandLogoUrl={organization.brandLogoUrl}
      initialDefaultVisibility={organization.defaultVisibility}
    />
  );
}
