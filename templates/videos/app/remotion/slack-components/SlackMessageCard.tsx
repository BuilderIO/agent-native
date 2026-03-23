/**
 * SlackMessageCard - Individual message in the chat area
 */
import React from "react";

interface Reaction {
  emoji: string;
  count: number;
}

interface SlackMessageCardProps {
  avatar: string;
  author: string;
  timestamp: string;
  content: string | React.ReactNode;
  reactions?: Reaction[];
  threadReplies?: number;
  threadPreview?: string;
  threadAvatar?: string;
  threadIndicatorOpacity?: number;
  threadIndicatorHoverProgress?: number;
  hoverProgress?: number;
}

export const SlackMessageCard: React.FC<SlackMessageCardProps> = ({
  avatar,
  author,
  timestamp,
  content,
  reactions = [],
  threadReplies,
  threadPreview,
  threadAvatar,
  threadIndicatorOpacity = 1,
  threadIndicatorHoverProgress = 0,
  hoverProgress = 0,
}) => {
  const bgOpacity = hoverProgress * 0.05;
  // Thread indicator background darkens on hover
  const threadBgOpacity = 0.03 + threadIndicatorHoverProgress * 0.05;

  return (
    <div
      style={{
        display: "flex",
        gap: 22,
        width: "100%",
        padding: "0 0 27px 0",
        background: `rgba(255, 255, 255, ${bgOpacity})`,
        borderRadius: 10,
        transition: "background-color 0.2s",
      }}
    >
      {/* Avatar */}
      <img
        src={avatar}
        alt={author}
        style={{
          width: 62,
          height: 62,
          borderRadius: 8,
          objectFit: "cover",
        }}
      />

      {/* Message content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              color: "rgba(248, 248, 248, 1)",
              fontSize: 19,
              fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
              fontWeight: 600,
            }}
          >
            {author}
          </div>
          <div
            style={{
              color: "rgba(171, 171, 173, 1)",
              fontSize: 16,
              fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
              fontWeight: 400,
            }}
          >
            {timestamp}
          </div>
        </div>

        {/* Message text */}
        <div
          style={{
            color: "rgba(255, 255, 255, 1)",
            fontSize: 19,
            fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
            fontWeight: 400,
            lineHeight: "30px",
          }}
        >
          {content}
        </div>

        {/* Reactions */}
        {reactions.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 7,
              marginTop: 10,
            }}
          >
            {reactions.map((reaction, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "4px 14px",
                  borderRadius: 32,
                  background: "rgba(51, 57, 65, 1)",
                  border: "1px solid rgba(75, 75, 75, 1)",
                }}
              >
                <div style={{ fontSize: 19 }}>{reaction.emoji}</div>
                <div
                  style={{
                    color: "rgba(255, 255, 255, 1)",
                    fontSize: 16,
                    fontFamily:
                      "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                  }}
                >
                  {reaction.count}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Thread indicator */}
        {threadReplies && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              marginTop: 18,
              padding: "10px 16px",
              borderRadius: 8,
              background:
                threadIndicatorHoverProgress > 0
                  ? `rgba(0, 0, 0, ${threadBgOpacity})`
                  : "transparent",
              border:
                threadIndicatorHoverProgress > 0
                  ? `1px solid rgba(255, 255, 255, ${0.08 + threadIndicatorHoverProgress * 0.04})`
                  : "1px solid transparent",
              opacity: threadIndicatorOpacity,
              transform: `scale(${0.96 + threadIndicatorOpacity * 0.04})`,
              transformOrigin: "left center",
              cursor: "pointer",
              minWidth: 450,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <img
                src={threadAvatar || avatar}
                alt=""
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: threadAvatar ? 8 : 6,
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                fontFamily:
                  "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                fontSize: 18,
                fontWeight: 600,
                flex: 1,
              }}
            >
              <div
                style={{
                  color: "rgba(43, 165, 206, 1)",
                  textAlign: "center",
                }}
              >
                {threadReplies} {threadReplies === 1 ? "reply" : "replies"}
              </div>
              <div style={{ color: "rgba(171, 171, 173, 1)", fontWeight: 400 }}>
                {threadIndicatorHoverProgress > 0.5
                  ? "View thread"
                  : threadPreview}
              </div>
            </div>
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/60e50d59712ec33d5f7c588a331a4d2da0dca9c4"
              alt=""
              style={{
                width: 16,
                height: 11,
                opacity: 0.6,
                transform: "rotate(-90deg)",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
