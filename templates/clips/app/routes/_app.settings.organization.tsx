import { useMemo } from "react";
import { IconBuilding, IconMailFast, IconUsers } from "@tabler/icons-react";
import { useActionQuery, useSession } from "@agent-native/core/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandingEditor } from "@/components/workspace/branding-editor";
import {
  MembersList,
  type MemberRole,
} from "@/components/workspace/members-list";
import { InviteDialog } from "@/components/workspace/invite-dialog";

export function meta() {
  return [{ title: "Organization settings · Clips" }];
}

interface OrganizationStateResponse {
  organization: {
    id: string;
    name: string;
    slug: string;
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
    expiresAt: string | null;
  }[];
}

export default function OrganizationSettingsRoute() {
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

  const isAdmin = currentRole === "admin" || isOwner;

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No organization yet. Create one from the organization switcher to
            get started.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <IconBuilding className="size-6 text-primary" />
          {organization.name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Organization admin: branding, members, invites.
        </p>
      </div>

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
            <CardTitle className="text-base">Branding</CardTitle>
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
                  Only admins can edit branding.
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
            Members
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
            Pending invites
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No pending invites.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-32">Role</TableHead>
                    <TableHead className="w-32">Sent</TableHead>
                    <TableHead className="w-32">Expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {inv.role.replace("-", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(inv.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {inv.expiresAt
                          ? new Date(inv.expiresAt).toLocaleDateString()
                          : "—"}
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
  );
}
