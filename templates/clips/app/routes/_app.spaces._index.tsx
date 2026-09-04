import { useT } from "@agent-native/core/client/i18n";
import { useOrgRole } from "@agent-native/core/client/org";
import { IconPlus, IconUsersGroup } from "@tabler/icons-react";
import { useState } from "react";

import { CreateSpaceDialog } from "@/components/library/create-space-dialog";
import {
  PageBreadcrumb,
  PageHeader,
  PageHeaderPrimaryAction,
} from "@/components/library/page-header";
import { SpaceCard, type SpaceCardData } from "@/components/library/space-card";
import { useSpaces, useOrganizations } from "@/hooks/use-library";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.clipsFinalRaw.spacesPageTitle }];
}

function Skeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="h-24 bg-muted" />
      <div className="p-3 space-y-2">
        <div className="h-4 w-1/2 rounded bg-muted" />
        <div className="h-3 w-3/4 rounded bg-muted" />
      </div>
    </div>
  );
}

export default function SpacesIndexRoute() {
  const t = useT();
  const [createOpen, setCreateOpen] = useState(false);
  const { canManageOrg } = useOrgRole();
  const { data: organizations } = useOrganizations();
  const currentOrganizationId =
    organizations?.currentId ?? organizations?.organizations?.[0]?.id;
  const { data, isLoading, refetch } = useSpaces(currentOrganizationId);

  const spaces: SpaceCardData[] = (data?.spaces ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    iconEmoji: s.iconEmoji,
    memberCount: s.memberCount ?? 0,
    recordingCount: s.recordingCount ?? 0,
    memberEmails: s.memberEmails ?? [],
  }));

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <PageHeader>
        <PageBreadcrumb label={t("navigation.spaces")} />
        {canManageOrg && (
          <div className="ml-auto">
            <PageHeaderPrimaryAction onClick={() => setCreateOpen(true)}>
              <IconPlus />
              {t("createSpaceDialog.newSpace")}
            </PageHeaderPrimaryAction>
          </div>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-5">
        {isLoading ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} />
            ))}
          </div>
        ) : spaces.length === 0 ? (
          <div className="flex min-h-full items-center justify-center p-6">
            <div className="flex max-w-sm flex-col items-center text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <IconUsersGroup className="size-6" />
              </div>
              <h2 className="text-base font-semibold text-foreground">
                {t("navigation.noSpaces")}
              </h2>
              {canManageOrg ? (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {t("createSpaceDialog.description")}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {spaces.map((s) => (
              <SpaceCard
                key={s.id}
                space={s}
                onMutationSuccess={() => refetch?.()}
              />
            ))}
          </div>
        )}
      </div>

      <CreateSpaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={currentOrganizationId}
      />
    </div>
  );
}
