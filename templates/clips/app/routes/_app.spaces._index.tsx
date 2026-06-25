import { useT } from "@agent-native/core/client";
import { IconPlus, IconUsersGroup } from "@tabler/icons-react";
import { useState } from "react";

import { CreateSpaceDialog } from "@/components/library/create-space-dialog";
import { EmptyState } from "@/components/library/empty-state";
import { PageHeader } from "@/components/library/page-header";
import { SpaceCard, type SpaceCardData } from "@/components/library/space-card";
import { Button } from "@/components/ui/button";
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
  const { data: organizations } = useOrganizations();
  const currentOrganizationId =
    organizations?.currentId ?? organizations?.organizations?.[0]?.id;
  const { data, isLoading } = useSpaces(currentOrganizationId);

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
        <div className="flex items-center gap-2">
          <IconUsersGroup className="h-4 w-4 text-primary" />
          <h1 className="text-base font-semibold text-foreground">
            {t("navigation.spaces")}
          </h1>
        </div>
        <div className="ml-auto">
          <Button
            size="sm"
            className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => setCreateOpen(true)}
          >
            <IconPlus className="h-4 w-4" /> {t("createSpaceDialog.newSpace")}
          </Button>
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-5">
        {isLoading ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} />
            ))}
          </div>
        ) : spaces.length === 0 ? (
          <EmptyState kind="space" />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {spaces.map((s) => (
              <SpaceCard key={s.id} space={s} />
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
