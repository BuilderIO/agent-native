/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CHAT MESSAGE ATOMS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Chat message bubbles for user and agent messages in the workspace.
 *
 * Features:
 * - UserMessage with gradient overlay and chevron for long text
 * - AgentMessage with thinking indicator and tool cards
 * - Restore to point link
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";

export type UserMessageProps = {
  text: string;
  avatarUrl?: string;
};

export const UserMessage: React.FC<UserMessageProps> = ({ text, avatarUrl }) => {
  // Only show chevron/gradient for long messages (roughly > 150 chars)
  const isLongMessage = text.length > 150;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
      }}
    >
      {/* Restore link */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 14,
          color: "#48a1ff",
          fontFamily: "Inter, sans-serif",
          fontWeight: 500,
          lineHeight: 23 / 14,
          alignSelf: "flex-end",
          cursor: "pointer",
        }}
      >
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5f2526ef8d2af2c7bee3cd518fbbc5c31cda8a94?placeholderIfAbsent=true"
          alt=""
          style={{ width: 21, aspectRatio: 1, objectFit: "contain" }}
        />
        <div>Restore to this point</div>
      </div>

      {/* Message bubble */}
      <div
        style={{
          display: "flex",
          alignItems: "start",
          gap: 7,
          fontSize: 15,
          color: "#b9b9b9",
          fontFamily: "Inter, sans-serif",
          fontWeight: 400,
          marginTop: 15,
        }}
      >
        {/* Message with gradient overlay */}
        <div
          style={{
            borderRadius: 10,
            backgroundColor: "#2a2a2a",
            position: "relative",
            minWidth: 240,
            maxHeight: isLongMessage ? 142 : undefined,
            padding: "17px 14px",
            display: "flex",
            alignItems: "start",
            justifyContent: "center",
            overflow: "hidden",
            flex: 1,
          }}
        >
          <div style={{ width: "100%", position: "relative", zIndex: 0 }}>
            {text}
          </div>
          {/* Gradient overlay for long text - only show when message is long */}
          {isLongMessage && (
            <div
              style={{
                position: "absolute",
                right: 0,
                bottom: 0,
                width: "100%",
                height: "100%",
                background: "linear-gradient(180deg, transparent 0%, transparent 70%, #2a2a2a 100%)",
                pointerEvents: "none",
                zIndex: 1,
              }}
            />
          )}
          {/* Chevron icon - only show when message is long */}
          {isLongMessage && (
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/b00ea684ecadf5904dbcb7c33d7021e9dc88188a?placeholderIfAbsent=true"
              alt=""
              style={{
                position: "absolute",
                left: "50%",
                bottom: 13,
                transform: "translateX(-50%)",
                width: 19,
                aspectRatio: 1,
                objectFit: "contain",
                zIndex: 2,
                cursor: "pointer",
              }}
            />
          )}
        </div>

        {/* Avatar */}
        <img
          src={avatarUrl || "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/d14e996f0be0b20c787a293fa3f01a69d1b9e6af?placeholderIfAbsent=true"}
          alt=""
          style={{
            width: 37,
            aspectRatio: 1,
            objectFit: "contain",
            borderRadius: 19,
          }}
        />
      </div>
    </div>
  );
};

export type AgentMessageProps = {
  text: string;
  showThinking?: boolean;
  toolCards?: { icon: string; text: string }[];
  isCompleted?: boolean;
  thinkingText?: string;
};

export const AgentMessage: React.FC<AgentMessageProps> = ({
  text,
  showThinking = false,
  toolCards = [],
  isCompleted = false,
  thinkingText = "Sometimes, when thinking for a long time with a lot of text, the agent will write in a collapsed-by-default accordion window. This is used so that long periods of thought are not distracting to the user. It's often used during the completion of a task. When that task is completed, a green check is added to the left area of the message window.",
}) => {
  return (
    <div
      style={{
        display: "flex",
        marginTop: 14,
        width: "100%",
        paddingLeft: 6,
        paddingRight: 6,
        flexDirection: "column",
        fontSize: 14,
        color: "#a4a4a4",
        fontFamily: "Inter, sans-serif",
        fontWeight: 400,
      }}
    >
      {/* Thinking indicator */}
      {showThinking && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            alignSelf: "flex-start",
            lineHeight: 1.38,
          }}
        >
          <div
            style={{
              borderRadius: "50%",
              width: 20,
              height: 20,
              background: "linear-gradient(135deg, #48a1ff 0%, #9747ff 100%)",
            }}
          />
          <div>Thinking</div>
        </div>
      )}

      {/* Tool cards */}
      {toolCards.map((card, index) => (
        <div
          key={index}
          style={{
            borderRadius: 6,
            backgroundColor: "#292929",
            display: "flex",
            marginTop: 21,
            width: "100%",
            padding: "11px 13px",
            alignItems: "center",
            gap: 10,
            overflow: "hidden",
            lineHeight: 1.38,
          }}
        >
          <img
            src={card.icon}
            alt=""
            style={{
              width: 19,
              aspectRatio: 1,
              objectFit: "contain",
              flexShrink: 0,
            }}
          />
          <div
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {card.text}
          </div>
        </div>
      ))}

      {/* Message text */}
      <div
        style={{
          color: "#b9b9b9",
          fontSize: 15,
          marginTop: toolCards.length > 0 ? 21 : showThinking ? 21 : 0,
        }}
      >
        {text}
      </div>

      {/* Completion indicator (if task is done) */}
      {isCompleted && (
        <div
          style={{
            position: "relative",
            display: "flex",
            marginTop: 21,
            alignItems: "flex-start",
            gap: 21,
            overflow: "hidden",
            fontSize: 15,
            color: "#b9b9b9",
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/73d1d1c540b9e7a873b79ab24f5a2e7b3d824eca?placeholderIfAbsent=true"
            alt=""
            style={{
              width: 21,
              aspectRatio: 1,
              objectFit: "contain",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1 }}>
            {thinkingText}
          </div>
          {/* Gradient overlay */}
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: "100%",
              height: "100%",
              background: "linear-gradient(180deg, transparent 0%, transparent 60%, #191919 100%)",
              pointerEvents: "none",
            }}
          />
          {/* Chevron */}
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/46f501d80f698b45a19cb732f30177e7bed46a4d?placeholderIfAbsent=true"
            alt=""
            style={{
              position: "absolute",
              right: 126,
              bottom: 0,
              width: 19,
              aspectRatio: 1.33,
              objectFit: "contain",
            }}
          />
        </div>
      )}
    </div>
  );
};
