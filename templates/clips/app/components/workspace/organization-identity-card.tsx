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
import { organizationLogoUrl } from "@/lib/organization-logo";

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

export function OrganizationIdentityCard() {
  const t = useT();
  const { session } = useSession();
  const email = session?.email ?? "";
  const {
    data: orgInfo,
    isLoading: orgLoading,
    isError: isOrgError,
    isFetching: isOrgFetching,
  } = useOrg();
  const activeOrgId = orgInfo?.orgId ?? null;
  const hasActiveOrg = Boolean(activeOrgId);

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

  const loadFailed = (
    <Card>
      <CardContent className="py-6 text-center text-sm text-muted-foreground">
        {t("organizationSettings.brandingLoadFailed")}
      </CardContent>
    </Card>
  );

  if (isOrgError) return loadFailed;
  if (isError) {
    return isOrgFetching ? <Skeleton className="h-64 w-full" /> : loadFailed;
  }
  if (orgLoading) return <Skeleton className="h-64 w-full" />;
  if (!hasActiveOrg) return null;
  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (!organization) return null;

  if (!isAdmin) {
    const logoUrl = organizationLogoUrl(
      organization.brandLogoUrl,
      organization.id,
    );
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("brandingEditor.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
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
