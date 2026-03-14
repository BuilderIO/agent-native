/**
 * JiraActivity - Activity section with tabs and comments
 */

import React from "react";
import { JiraTab } from "./JiraTab";
import { JiraCommentInput } from "./JiraCommentInput";
import { JiraCommentCard } from "./JiraCommentCard";

interface JiraActivityProps {
  x: number;
  y: number;
  width: number;
  activeTab?: "all" | "comments" | "history" | "worklog";
  allTabHovered?: boolean;
  commentsTabHovered?: boolean;
  historyTabHovered?: boolean;
  worklogTabHovered?: boolean;
  allTabProgress?: number;
  commentsTabProgress?: number;
  historyTabProgress?: number;
  worklogTabProgress?: number;
  commentInputHovered?: boolean;
  commentInputProgress?: number;
  // Comment visibility and animation
  showFirstComment?: boolean;
  showSecondComment?: boolean;
  firstCommentSpring?: number;
  secondCommentSpring?: number;
}

export const JiraActivity: React.FC<JiraActivityProps> = ({
  x,
  y,
  width,
  activeTab = "comments",
  allTabHovered = false,
  commentsTabHovered = false,
  historyTabHovered = false,
  worklogTabHovered = false,
  allTabProgress = 0,
  commentsTabProgress = 0,
  historyTabProgress = 0,
  worklogTabProgress = 0,
  commentInputHovered = false,
  commentInputProgress = 0,
  showFirstComment = true,
  showSecondComment = true,
  firstCommentSpring = 1,
  secondCommentSpring = 1,
}) => {
  return (
    <div
      style={{
        position: "relative",
        width,
        display: "flex",
        flexDirection: "column",
        fontFamily: "Segoe UI, sans-serif",
      }}
    >
      {/* Activity header */}
      <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            fontSize: 24,
            color: "rgba(231, 231, 231, 1)",
            fontWeight: 700,
            lineHeight: 1.25,
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/de14cdd03cf62231f58d54ee6297338c101de124?placeholderIfAbsent=true"
            alt="Activity"
            style={{ width: 18, height: 18, objectFit: "contain" }}
          />
          <div>Activity</div>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "28px",
            marginTop: 18,
          }}
        >
          <JiraTab
            label="All"
            isActive={activeTab === "all"}
            isHovered={allTabHovered}
            hoverProgress={allTabProgress}
          />
          <JiraTab
            label="Comments"
            isActive={activeTab === "comments"}
            isHovered={commentsTabHovered}
            hoverProgress={commentsTabProgress}
          />
          <JiraTab
            label="History"
            isActive={activeTab === "history"}
            isHovered={historyTabHovered}
            hoverProgress={historyTabProgress}
          />
          <JiraTab
            label="Work log"
            isActive={activeTab === "worklog"}
            isHovered={worklogTabHovered}
            hoverProgress={worklogTabProgress}
          />
        </div>
      </div>

      {/* Comment input */}
      <div style={{ marginTop: 36 }}>
        <JiraCommentInput
          x={0}
          y={0}
          width={width}
          avatarSrc="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/de43b059c7ff55947168ed77c06d48f98e7d746e?placeholderIfAbsent=true"
          isHovered={commentInputHovered}
          hoverProgress={commentInputProgress}
        />
      </div>

      {/* Comment 2 - Builder.io Bot - AI work complete (appears second, ABOVE first comment) */}
      {showSecondComment && (
        <div style={{
          marginTop: 36,
          opacity: secondCommentSpring,
          transform: `translateY(${(1 - secondCommentSpring) * 20}px) scale(${0.95 + secondCommentSpring * 0.05})`,
          transformOrigin: "top left",
        }}>
          <JiraCommentCard
            x={0}
            y={0}
            width={width}
            avatarSrc="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/70011344967eeb374ef512bab52ee2961ef17707?placeholderIfAbsent=true"
            username="Builder.io Bot"
            timestamp="just now"
            content={
              <div style={{ whiteSpace: "pre-line" }}>
                ✅ AI work complete!
                <br />
                💬 Message added to existing branch!
                <br />
                📁 Project: acme-sales-dash
                <br />
                🌳 Branch: story-buffer-gyjdjokk
                <br />
                <span style={{ textDecoration: "underline", color: "#48a1ff", cursor: "pointer" }}>
                  🔗 View/Edit in Builder.io
                </span>
              </div>
            }
          />
        </div>
      )}

      {/* Comment 1 - Builder.io Bot - Working on request (appears first, gets pushed down when second appears) */}
      {showFirstComment && (
        <div style={{
          marginTop: showSecondComment ? 36 : 36,
          opacity: firstCommentSpring,
          transform: `translateY(${(1 - firstCommentSpring) * 20}px) scale(${0.95 + firstCommentSpring * 0.05})`,
          transformOrigin: "top left",
        }}>
          <JiraCommentCard
            x={0}
            y={0}
            width={width}
            avatarSrc="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/70011344967eeb374ef512bab52ee2961ef17707?placeholderIfAbsent=true"
            username="Builder.io Bot"
            timestamp="just now"
            content={
              <div style={{ whiteSpace: "pre-line" }}>
                🤖 The Builder.io bot is working on your request!
                <br />
                📁 Project: acme-sales-dash
                <br />
                🌳 Branch: story-buffer-gyjdjokk
                <br />
                <span style={{ textDecoration: "underline", color: "#48a1ff", cursor: "pointer" }}>
                  🔗 View/Edit in Builder.io
                </span>
              </div>
            }
          />
        </div>
      )}
    </div>
  );
};
