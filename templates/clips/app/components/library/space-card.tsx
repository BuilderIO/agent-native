import { useT } from "@agent-native/core/client/i18n";
import { useOrgRole } from "@agent-native/core/client/org";
import {
  IconUsersGroup,
  IconVideo,
  IconTrash,
  IconEdit,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

import { SpaceDialogs } from "./space-dialogs";

export interface SpaceCardData {
  id: string;
  name: string;
  color?: string | null;
  iconEmoji?: string | null;
  memberCount?: number;
  recordingCount?: number;
  memberEmails?: string[];
}

interface SpaceCardProps {
  space: SpaceCardData;
  className?: string;
  onMutationSuccess?: () => void;
}

export function SpaceCard({
  space,
  className,
  onMutationSuccess,
}: SpaceCardProps) {
  const t = useT();
  const { canManageOrg } = useOrgRole();
  const color = space.color || "hsl(var(--primary))";
  const members = space.memberEmails ?? [];
  const initial = (space.name.trim().slice(0, 1) || "S").toUpperCase();
  const [renameSpaceId, setRenameSpaceId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteSpaceId, setDeleteSpaceId] = useState<string | null>(null);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Link
            to={`/spaces/${space.id}`}
            className={cn(
              "group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-start",
              "hover:border-primary/40",
              "shadow-3d-card hover:shadow-3d-card-hover hover:-translate-y-px transition-all duration-200",
              className,
            )}
          >
            <div
              className="relative flex h-24 items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
              }}
            >
              {space.iconEmoji ? (
                <span className="text-3xl">{space.iconEmoji}</span>
              ) : (
                <span className="text-3xl font-semibold text-white">
                  {initial}
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col p-3">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {space.name}
              </h3>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1">
                  <IconUsersGroup className="h-3.5 w-3.5" />
                  <span>
                    {space.memberCount ?? members.length} member
                    {(space.memberCount ?? members.length) === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <IconVideo className="h-3.5 w-3.5" />
                  <span>
                    {space.recordingCount ?? 0} recording
                    {(space.recordingCount ?? 0) === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              {members.length > 0 && (
                <div className="mt-2 flex -space-x-1">
                  {members.slice(0, 5).map((email) => {
                    const initials = (email.split("@")[0] || "?")
                      .slice(0, 2)
                      .toUpperCase();
                    return (
                      <div
                        key={email}
                        title={email}
                        className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-primary/15 text-[9px] font-medium text-primary"
                      >
                        {initials}
                      </div>
                    );
                  })}
                  {members.length > 5 && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-muted text-[9px] text-muted-foreground">
                      +{members.length - 5}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Link>
        </ContextMenuTrigger>
        {canManageOrg && (
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() => {
                setTimeout(() => {
                  setRenameValue(space.name);
                  setRenameSpaceId(space.id);
                }, 0);
              }}
            >
              <IconEdit className="h-4 w-4 mr-2" />
              {t("spaceDialog.renameSpace")}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                setTimeout(() => setDeleteSpaceId(space.id), 0);
              }}
              className="text-destructive focus:text-destructive"
            >
              <IconTrash className="h-4 w-4 mr-2" />
              {t("spaceDialog.deleteSpace")}
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      <SpaceDialogs
        renameSpaceId={renameSpaceId}
        renameSpaceName={space.name}
        setRenameSpaceId={setRenameSpaceId}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        deleteSpaceId={deleteSpaceId}
        deleteSpaceName={space.name}
        setDeleteSpaceId={setDeleteSpaceId}
        onMutationSuccess={onMutationSuccess}
      />
    </>
  );
}
