import { useMemo } from "react";
import {
  type CollabUser,
  emailToColor,
  emailToName,
} from "../../collab/client.js";

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
}

const AVATAR_SIZE = 28;
const OVERLAP = -8;
const BORDER_WIDTH = 2;
const FONT_SIZE = 12;
const AGENT_COLOR = "#a78bfa";

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

function UserAvatar({ user, isFirst }: { user: CollabUser; isFirst: boolean }) {
  const color = emailToColor(user.email);
  const name = emailToName(user.email);
  const initial = name.charAt(0).toUpperCase();

  return (
    <div
      style={{
        ...baseAvatarStyle,
        backgroundColor: color,
        marginLeft: isFirst ? 0 : OVERLAP,
      }}
      title={name}
    >
      {initial}
    </div>
  );
}

function AgentAvatar({ active }: { active: boolean }) {
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
        }}
        title={active ? "AI is editing" : "AI agent"}
      >
        A
      </div>
      {active && <AgentEditingChip />}
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
}: PresenceBarProps) {
  const { humanUsers, showAgent } = useMemo(() => {
    const humans = activeUsers.filter(
      (u) => u.email !== currentUserEmail && u.email !== "agent@system",
    );
    const hasAgentUser = activeUsers.some((u) => u.email === "agent@system");
    return {
      humanUsers: humans,
      showAgent: agentPresent || agentActive || hasAgentUser,
    };
  }, [activeUsers, currentUserEmail, agentPresent, agentActive]);

  const visibleUsers = humanUsers.slice(0, maxVisible);
  const overflowCount = humanUsers.length - visibleUsers.length;

  if (!showAgent && humanUsers.length === 0) return null;

  return (
    <div style={containerStyle} className={className}>
      {showAgent && <AgentAvatar active={!!agentActive} />}
      {visibleUsers.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginLeft: showAgent ? 6 : 0,
          }}
        >
          {visibleUsers.map((u, i) => (
            <UserAvatar key={`${u.email}-${i}`} user={u} isFirst={i === 0} />
          ))}
          {overflowCount > 0 && (
            <OverflowBadge count={overflowCount} isFirst={false} />
          )}
        </div>
      )}
    </div>
  );
}
