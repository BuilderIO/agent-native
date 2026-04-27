/**
 * Presence bar showing active collaborators on a composition.
 *
 * Displays colored avatar circles with initials for each active user,
 * plus an agent activity indicator when the AI is editing.
 */

import { IconBolt } from "@tabler/icons-react";
import type { CollabUser } from "@agent-native/core/client";
import { cn } from "@/lib/utils";

interface CollabPresenceBarProps {
  activeUsers: CollabUser[];
  agentActive: boolean;
  agentPresent: boolean;
  className?: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function CollabPresenceBar({
  activeUsers,
  agentActive,
  agentPresent,
  className,
}: CollabPresenceBarProps) {
  // Filter out the agent from user avatars (handled separately)
  const humanUsers = activeUsers.filter((u) => u.email !== "agent@system");
  const hasPresence = humanUsers.length > 0 || agentPresent;

  if (!hasPresence) return null;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {/* Human user avatars */}
      {humanUsers.map((user) => (
        <div
          key={user.email}
          className="flex items-center justify-center w-6 h-6 rounded-full text-[9px] font-semibold text-white shrink-0"
          style={{ backgroundColor: user.color }}
          title={`${user.name} (${user.email})`}
        >
          {getInitials(user.name)}
        </div>
      ))}

      {/* Agent presence indicator */}
      {agentPresent && (
        <div
          className={cn(
            "flex items-center justify-center w-6 h-6 rounded-full shrink-0",
            agentActive
              ? "bg-violet-500/20 ring-1 ring-violet-400/50"
              : "bg-muted",
          )}
          title={agentActive ? "AI is editing" : "AI agent connected"}
        >
          <IconBolt
            size={12}
            className={cn(
              agentActive
                ? "text-violet-400 animate-pulse"
                : "text-muted-foreground",
            )}
          />
        </div>
      )}
    </div>
  );
}
