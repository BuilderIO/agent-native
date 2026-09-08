import type { CollabUser } from "@agent-native/core/client/collab";
import { emailToColor, emailToName } from "@agent-native/core/client/collab";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface DesignCollaborator {
  user: CollabUser;
  image?: string;
  isCurrent?: boolean;
}

function userInitial(nameOrEmail: string): string {
  const trimmed = nameOrEmail.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

function userColor(user: CollabUser): string {
  return user.color || emailToColor(user.email);
}

export function DesignCollaboratorAvatar({
  collaborator,
  className,
}: {
  collaborator: DesignCollaborator;
  className?: string;
}) {
  const label = collaborator.user.name || emailToName(collaborator.user.email);
  const storedAvatarUrl = useAvatarUrl(collaborator.user.email);
  const avatarUrl = storedAvatarUrl ?? collaborator.image;

  return (
    <Avatar
      className={cn(
        "size-7 border-2 border-[var(--design-editor-panel-bg)] shadow-sm",
        className,
      )}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={label} /> : null}
      <AvatarFallback
        /* guard:allow-raw-color — avatar initials sit on a generated user color, not a themed surface */
        className="text-[10px] font-semibold text-white"
        style={{ backgroundColor: userColor(collaborator.user) }}
      >
        {userInitial(label || collaborator.user.email)}
      </AvatarFallback>
    </Avatar>
  );
}

export function DesignCollaboratorsMenu({
  collaborators,
  followingEmail,
  label,
  onAvatarClick,
}: {
  collaborators: DesignCollaborator[];
  followingEmail?: string | null;
  label: string;
  onAvatarClick?: (user: CollabUser | null) => void;
}) {
  if (collaborators.length === 0) return null;

  const visibleCollaborators = collaborators.slice(0, 3);
  const hasMultipleCollaborators = collaborators.length > 1;
  const followingLower = followingEmail?.trim().toLowerCase() ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 cursor-pointer items-center rounded-md pr-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          aria-label={label}
        >
          <span className="flex items-center">
            {visibleCollaborators.map((collaborator, index) => (
              <DesignCollaboratorAvatar
                key={`${collaborator.user.email}:${index}`}
                collaborator={collaborator}
                className={index === 0 ? undefined : "-ml-2"}
              />
            ))}
          </span>
          {hasMultipleCollaborators ? (
            <IconChevronDown className="ml-0.5 size-3 opacity-70" />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {label}
        </DropdownMenuLabel>
        {collaborators.map((collaborator) => {
          const user = collaborator.user;
          const email = user.email.trim().toLowerCase();
          const isFollowing =
            followingLower != null && email === followingLower;
          const name = user.name || emailToName(user.email);

          return (
            <DropdownMenuItem
              key={user.email}
              onSelect={(event) => {
                if (collaborator.isCurrent) {
                  event.preventDefault();
                  return;
                }
                onAvatarClick?.(user);
              }}
              className={cn(
                "gap-2",
                collaborator.isCurrent && "cursor-default",
              )}
            >
              <DesignCollaboratorAvatar collaborator={collaborator} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </span>
              {collaborator.isCurrent ? (
                <span className="text-xs text-muted-foreground">
                  {"You" /* i18n-ignore collaborator row */}
                </span>
              ) : isFollowing ? (
                <IconCheck className="size-3.5 text-[var(--design-editor-accent-color)]" />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {"Follow" /* i18n-ignore collaborator row */}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
