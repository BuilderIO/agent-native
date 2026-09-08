import { useMemo, type CSSProperties } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";
import {
  type CollabUser,
  dedupeCollabUsersByEmail,
  emailToColor,
  emailToName,
} from "./types.js";

export interface PresenceBarProps {
  /** Active collaborators on this document. */
  activeUsers: CollabUser[];
  /** Whether the agent has a durable presence entry. */
  agentPresent?: boolean;
  /** Whether the agent is actively making edits right now. */
  agentActive?: boolean;
  /** @deprecated Agent editing is represented by the AI presence circle and tooltip. */
  showAgentEditingDot?: boolean;
  /** Current user's email (to exclude from the list). */
  currentUserEmail?: string;
  /** Max visible avatars before "+N" overflow. Default: 5 */
  maxVisible?: number;
  /** Additional CSS classes. */
  className?: string;
  /**
   * Called when an avatar is clicked. Receives the user being clicked
   * (or null for the agent avatar). Use this to start/stop follow mode.
   */
  onAvatarClick?: (user: CollabUser | null) => void;
  /** Keep the AI avatar display-only when no agent viewport can be followed. */
  disableAgentClick?: boolean;
  /**
   * The email of the user currently being followed. Highlighted with a
   * blue ring to indicate active follow mode.
   */
  followingEmail?: string | null;
}

const AVATAR_SIZE = 28;
const OVERLAP = -8;
const BORDER_WIDTH = 2;
const FONT_SIZE = 12;
const AGENT_COLOR = "#00B5FF";

const baseAvatarStyle: CSSProperties = {
  width: AVATAR_SIZE,
  height: AVATAR_SIZE,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: FONT_SIZE,
  fontWeight: 700,
  color: "#fff",
  border: `${BORDER_WIDTH}px solid #fff`,
  flexShrink: 0,
  position: "relative",
  cursor: "default",
  boxSizing: "border-box",
};

const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexDirection: "row",
};

const pulseKeyframes = `
@keyframes _anPresencePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
`;

let styleInjected = false;

function injectStyles() {
  if (styleInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = pulseKeyframes;
  document.head.appendChild(style);
  styleInjected = true;
}

function UserAvatar({
  user,
  isFirst,
  onClick,
  isFollowing,
}: {
  user: CollabUser;
  isFirst: boolean;
  onClick?: () => void;
  isFollowing?: boolean;
}) {
  const color = user.color || emailToColor(user.email);
  const name = user.name || emailToName(user.email);
  const initial = name.charAt(0).toUpperCase();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          style={{
            ...baseAvatarStyle,
            backgroundColor: color,
            marginLeft: isFirst ? 0 : OVERLAP,
            cursor: onClick ? "pointer" : "default",
            boxShadow: isFollowing
              ? `0 0 0 2px #3b82f6, 0 0 0 4px #fff`
              : `0 0 0 2px #fff`,
          }}
          aria-label={`${name} (${user.email})${isFollowing ? " — following" : ""}`}
          tabIndex={onClick ? 0 : undefined}
          role={onClick ? "button" : undefined}
          onClick={onClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onClick?.();
          }}
        >
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                objectFit: "cover",
              }}
            />
          ) : (
            initial
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isFollowing
          ? `Following ${name} — click to stop`
          : onClick
            ? `${name} — click to follow`
            : user.email}
      </TooltipContent>
    </Tooltip>
  );
}

function AgentAvatar({
  active,
  onClick,
  isFollowing,
}: {
  active: boolean;
  onClick?: () => void;
  isFollowing?: boolean;
}) {
  injectStyles();
  const tooltipLabel = isFollowing
    ? "Following AI — click to stop"
    : active
      ? "AI is editing"
      : "AI agent";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            style={{
              ...baseAvatarStyle,
              backgroundColor: AGENT_COLOR,
              marginLeft: 0,
              animation: active ? "_anPresencePulse 2s infinite" : undefined,
              cursor: onClick ? "pointer" : "default",
              boxShadow: isFollowing
                ? // guard:allow-raw-color -- existing follow-mode ring color
                  `0 0 0 2px #3b82f6, 0 0 0 4px #fff`
                : undefined,
            }}
            aria-label={tooltipLabel}
            onClick={onClick}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onClick?.();
            }}
            role={onClick ? "button" : undefined}
          >
            AI
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
      </Tooltip>
      {isFollowing && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 20,
            padding: "0 8px",
            borderRadius: 9999,
            backgroundColor: `#3b82f620`,
            color: "#3b82f6",
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          Following AI
        </span>
      )}
    </div>
  );
}

function OverflowMenu({
  users,
  followingEmail,
  onSelect,
}: {
  users: CollabUser[];
  followingEmail?: string | null;
  onSelect?: (user: CollabUser) => void;
}) {
  const followingLower = followingEmail?.trim().toLowerCase() ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          style={{
            ...baseAvatarStyle,
            backgroundColor: "hsl(var(--muted))",
            color: "hsl(var(--muted-foreground))",
            marginLeft: OVERLAP,
            fontSize: 10,
            cursor: "pointer",
          }}
          aria-label={`${users.length} more collaborator${users.length === 1 ? "" : "s"}`}
        >
          +{users.length}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>More collaborators</DropdownMenuLabel>
        {users.map((user) => {
          const name = user.name || emailToName(user.email);
          const isFollowing =
            followingLower != null &&
            user.email.trim().toLowerCase() === followingLower;
          return (
            <DropdownMenuItem
              key={user.email}
              onSelect={() => onSelect?.(user)}
            >
              <span
                style={{
                  ...baseAvatarStyle,
                  width: 24,
                  height: 24,
                  backgroundColor: user.color || emailToColor(user.email),
                  fontSize: 10,
                }}
              >
                {name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </span>
              {isFollowing ? (
                <span className="text-xs text-muted-foreground">Following</span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PresenceBar({
  activeUsers,
  agentPresent,
  agentActive,
  currentUserEmail,
  maxVisible = 5,
  className,
  onAvatarClick,
  disableAgentClick,
  followingEmail,
}: PresenceBarProps) {
  const { humanUsers, showAgent } = useMemo(() => {
    const currentEmail = currentUserEmail?.trim().toLowerCase();
    const uniqueUsers = dedupeCollabUsersByEmail(activeUsers);
    const humans = uniqueUsers.filter((u) => {
      const email = u.email.trim().toLowerCase();
      return email !== currentEmail && email !== "agent@system";
    });
    const hasAgentUser = uniqueUsers.some(
      (u) => u.email.trim().toLowerCase() === "agent@system",
    );
    return {
      humanUsers: humans,
      showAgent: agentPresent || agentActive || hasAgentUser,
    };
  }, [activeUsers, currentUserEmail, agentPresent, agentActive]);

  const visibleUsers = humanUsers.slice(0, maxVisible);
  const overflowUsers = humanUsers.slice(maxVisible);

  if (!showAgent && humanUsers.length === 0) return null;

  const followingLower = followingEmail?.trim().toLowerCase() ?? null;
  const isFollowingAgent = followingLower === "agent@system";

  return (
    <TooltipProvider delayDuration={150}>
      <div style={containerStyle} className={className}>
        {showAgent && (
          <AgentAvatar
            active={!!agentActive}
            onClick={
              !disableAgentClick && onAvatarClick
                ? () => onAvatarClick(null)
                : undefined
            }
            isFollowing={isFollowingAgent}
          />
        )}
        {visibleUsers.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginLeft: showAgent ? 6 : 0,
            }}
          >
            {visibleUsers.map((u, i) => (
              <UserAvatar
                key={u.email}
                user={u}
                isFirst={i === 0}
                onClick={onAvatarClick ? () => onAvatarClick(u) : undefined}
                isFollowing={
                  followingLower != null &&
                  u.email.trim().toLowerCase() === followingLower
                }
              />
            ))}
            {overflowUsers.length > 0 && (
              <OverflowMenu
                users={overflowUsers}
                followingEmail={followingEmail}
                onSelect={onAvatarClick ?? undefined}
              />
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
