import { useMemo } from "react";

import {
  type CollabUser,
  dedupeCollabUsersByEmail,
  emailToColor,
  emailToName,
} from "../../collab/client.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip.js";

export interface PresenceBarProps {
  /** Active collaborators on this document. */
  activeUsers: CollabUser[];
  /** Whether the agent has a durable presence entry. */
  agentPresent?: boolean;
  /** Whether the agent is actively making edits right now. */
  agentActive?: boolean;
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

const baseAvatarStyle: React.CSSProperties = {
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
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onClick?.();
          }}
        >
          {initial}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isFollowing ? `Following ${name} — click to stop` : user.email}
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

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <div
        style={{
          ...baseAvatarStyle,
          backgroundColor: AGENT_COLOR,
          marginLeft: 0,
          animation: active ? "_anPresencePulse 2s infinite" : undefined,
          cursor: onClick ? "pointer" : "default",
          boxShadow: isFollowing
            ? `0 0 0 2px #3b82f6, 0 0 0 4px #fff`
            : undefined,
        }}
        title={
          isFollowing
            ? "Following AI — click to stop"
            : active
              ? "AI is editing"
              : "AI agent"
        }
        onClick={onClick}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onClick?.();
        }}
        role={onClick ? "button" : undefined}
      >
        A
      </div>
      {active && !isFollowing && <AgentEditingChip />}
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

function AgentEditingChip() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 20,
        padding: "0 8px",
        borderRadius: 9999,
        backgroundColor: `${AGENT_COLOR}20`,
        color: AGENT_COLOR,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: AGENT_COLOR,
          animation: "_anPresencePulse 2s infinite",
          flexShrink: 0,
        }}
      />
      AI editing
    </span>
  );
}

function OverflowBadge({
  count,
  isFirst,
}: {
  count: number;
  isFirst: boolean;
}) {
  return (
    <div
      style={{
        ...baseAvatarStyle,
        backgroundColor: "rgba(255,255,255,0.1)",
        color: "rgba(255,255,255,0.5)",
        marginLeft: isFirst ? 0 : OVERLAP,
        fontSize: 10,
      }}
      title={`${count} more collaborator${count === 1 ? "" : "s"}`}
    >
      +{count}
    </div>
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
  const overflowCount = humanUsers.length - visibleUsers.length;

  if (!showAgent && humanUsers.length === 0) return null;

  const followingLower = followingEmail?.trim().toLowerCase() ?? null;
  const isFollowingAgent = followingLower === "agent@system";

  return (
    <TooltipProvider delayDuration={150}>
      <div style={containerStyle} className={className}>
        {showAgent && (
          <AgentAvatar
            active={!!agentActive}
            onClick={onAvatarClick ? () => onAvatarClick(null) : undefined}
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
            {overflowCount > 0 && (
              <OverflowBadge count={overflowCount} isFirst={false} />
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
