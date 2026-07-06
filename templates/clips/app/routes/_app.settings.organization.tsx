import { useActionQuery, useSession, useT } from "@agent-native/core/client";
import { Badge } from "@agent-native/toolkit/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@agent-native/toolkit/ui/card";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@agent-native/toolkit/ui/table";
import { IconMailFast, IconUsers } from "@tabler/icons-react";
import { useMemo } from "react";

import { PageHeader } from "@/components/library/page-header";
import { BrandingEditor } from "@/components/workspace/branding-editor";
import { InviteDialog } from "@/components/workspace/invite-dialog";
import {
  MembersList,
  type MemberRole,
} from "@/components/workspace/members-list";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.organizationSettings.pageTitle }];
}

interface OrganizationStateResponse {
  organization: {
    id: string;
    name: string;
    brandColor: string;
    brandLogoUrl: string | null;
    defaultVisibility: string;
    ownerEmail?: string;
  } | null;
  members: {
    id: string;
    email: string;
    role: MemberRole;
    joinedAt: string | null;
    invitedAt: string | null;
  }[];
  invites: {
    id: string;
    email: string;
    role: MemberRole;
    createdAt: string;
  }[];
}

export default function OrganizationSettingsRoute() {
  const t = useT();
  const { session } = useSession();
  const email = session?.email ?? "";

  const { data, isLoading } = useActionQuery<OrganizationStateResponse>(
    "list-organization-state",
    undefined,
  );

  const organization = data?.organization ?? null;
  const members = data?.members ?? [];
  const invites = data?.invites ?? [];

  const isOwner = !!(
    organization?.ownerEmail && organization.ownerEmail === email
  );
  const currentRole: MemberRole = useMemo(() => {
    const me = members.find((m) => m.email === email);
    if (me) return me.role;
    if (isOwner) return "admin";
    return "member";
  }, [members, email, isOwner]);

  const isAdmin = currentRole === "admin" || currentRole === "owner" || isOwner;

  if (isLoading) {
    return (
      <>
        <PageHeader>
          <h1 className="text-base font-semibold tracking-tight truncate">
            {t("organizationSettings.title")}
          </h1>
        </PageHeader>
        <div className="p-6 max-w-3xl mx-auto space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </>
    );
  }

  if (!organization) {
    return (
      <>
        <PageHeader>
          <h1 className="text-base font-semibold tracking-tight truncate">
            {t("organizationSettings.title")}
          </h1>
        </PageHeader>
        <div className="p-6 max-w-2xl mx-auto">
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              {t("organizationSettings.noOrganization")}
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          {t("organizationSettings.namedTitle", { name: organization.name })}
        </h1>
      </PageHeader>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <p className="text-sm text-muted-foreground">
          {t("organizationSettings.description")}
        </p>

        {isAdmin ? (
          <BrandingEditor
            organizationId={organization.id}
            initialName={organization.name}
            initialBrandColor={organization.brandColor}
            initialBrandLogoUrl={organization.brandLogoUrl}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("brandingEditor.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded"
                  style={{ background: organization.brandColor }}
                />
                <div>
                  <div className="font-medium">{organization.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("organizationSettings.adminsOnlyBranding")}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <IconUsers className="size-4 text-primary" />
              {t("organizationSettings.members")}
            </CardTitle>
            {isAdmin ? <InviteDialog organizationId={organization.id} /> : null}
          </CardHeader>
          <CardContent>
            <MembersList
              organizationId={organization.id}
              members={members}
              currentUserEmail={email}
              currentUserRole={currentRole}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <IconMailFast className="size-4 text-primary" />
              {t("organizationSettings.pendingInvites")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invites.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                {t("organizationSettings.noPendingInvites")}
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("organizationSettings.email")}</TableHead>
                      <TableHead className="w-32">
                        {t("organizationSettings.role")}
                      </TableHead>
                      <TableHead className="w-32">
                        {t("organizationSettings.sent")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">
                          {inv.email}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {inv.role.replace("-", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(inv.createdAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
