import { IconPlus, IconUsersGroup } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { SpaceCard, type SpaceCardData } from "@/components/library/space-card";
import { useSpaces, useWorkspaces } from "@/hooks/use-library";
import { EmptyState } from "@/components/library/empty-state";
import { toast } from "sonner";
import { sendToAgentChat } from "@agent-native/core/client";

export function meta() {
  return [{ title: "Spaces · Clips" }];
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
  const { data: workspaces } = useWorkspaces();
  const currentWorkspaceId =
    workspaces?.currentId ?? workspaces?.workspaces?.[0]?.id;
  const { data, isLoading } = useSpaces(currentWorkspaceId);

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
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <IconUsersGroup className="h-4 w-4 text-[#625DF5]" />
          <h1 className="text-base font-semibold text-foreground">Spaces</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Shared libraries for your team
        </p>
        <div className="ml-auto">
          <Button
            size="sm"
            className="gap-1.5 bg-[#625DF5] text-white hover:bg-[#554FE5]"
            onClick={() => {
              sendToAgentChat({
                message: "Create a new space for the team",
              });
              toast.info("Asking the agent to help create a space");
            }}
          >
            <IconPlus className="h-4 w-4" /> New space
          </Button>
        </div>
      </div>

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
    </div>
  );
}
