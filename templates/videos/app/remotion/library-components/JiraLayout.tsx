/**
 * JiraLayout - Main layout component combining header, content, and sidebar
 */

import React from "react";
import { JiraHeader } from "./JiraHeader";
import { JiraTaskHeader } from "./JiraTaskHeader";
import { JiraKeyDetails } from "./JiraKeyDetails";
import { JiraActivity } from "./JiraActivity";
import { JiraSidebar } from "./JiraSidebar";

interface JiraLayoutProps {
  width: number;
  height: number;

  // Star button
  starButtonHovered?: boolean;
  starButtonProgress?: number;

  // Activity tabs
  activeTab?: "all" | "comments" | "history" | "worklog";
  allTabHovered?: boolean;
  commentsTabHovered?: boolean;
  historyTabHovered?: boolean;
  worklogTabHovered?: boolean;
  allTabProgress?: number;
  commentsTabProgress?: number;
  historyTabProgress?: number;
  worklogTabProgress?: number;

  // Comment input
  commentInputHovered?: boolean;
  commentInputProgress?: number;

  // Sidebar buttons
  statusButtonHovered?: boolean;
  improveTaskButtonHovered?: boolean;
  statusButtonProgress?: number;
  improveTaskButtonProgress?: number;

  // Assignee animation
  assigneeState?: "unassigned" | "dropdown" | "typing" | "assigned";
  assigneeDropdownProgress?: number;
  typedText?: string;

  // Comment animations
  showFirstComment?: boolean;
  showSecondComment?: boolean;
  firstCommentSpring?: number;
  secondCommentSpring?: number;

  // Sidebar animation
  sidebarOffsetX?: number;
}

export const JiraLayout: React.FC<JiraLayoutProps> = ({
  width,
  height,
  starButtonHovered = false,
  starButtonProgress = 0,
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
  statusButtonHovered = false,
  improveTaskButtonHovered = false,
  statusButtonProgress = 0,
  improveTaskButtonProgress = 0,
  assigneeState = "assigned",
  assigneeDropdownProgress = 0,
  typedText = "",
  showFirstComment = true,
  showSecondComment = true,
  firstCommentSpring = 1,
  secondCommentSpring = 1,
  sidebarOffsetX = 0,
}) => {
  const headerHeight = 96;
  const sidebarWidth = 650;
  const contentWidth = width - sidebarWidth;
  const contentHeight = height - headerHeight;
  const contentPadding = 60;

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        backgroundColor: "#0a0a0a",
        overflow: "hidden",
        borderRadius: "20px",
        border: "1px solid rgba(255, 255, 255, 0.08)",
      }}
    >
      {/* Header */}
      <JiraHeader width={width} height={headerHeight} />

      {/* Main content area - Left side */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: headerHeight,
          width: contentWidth,
          height: contentHeight,
          backgroundColor: "rgba(31, 31, 33, 1)",
          border: "1px solid rgba(42, 42, 42, 1)",
          padding: `50px ${contentPadding}px 75px`,
          overflow: "auto",
        }}
      >
        {/* Task Header */}
        <div style={{ position: "relative" }}>
          <JiraTaskHeader
            x={0}
            y={0}
            width={contentWidth - contentPadding * 2}
            title="Build a sales attribution dashboard for Q4 2025"
            starButtonHovered={starButtonHovered}
            starButtonProgress={starButtonProgress}
          />
        </div>

        {/* Key Details */}
        <div style={{ marginTop: 24 }}>
          <JiraKeyDetails
            x={0}
            y={0}
            width={contentWidth - contentPadding * 2}
            description="Build a dashboard for our sales attribution for the Q4 2025 range with stats broken down per sales rep"
          />
        </div>

        {/* Activity Section */}
        <div style={{ marginTop: 32 }}>
          <JiraActivity
            x={0}
            y={0}
            width={contentWidth - contentPadding * 2}
            activeTab={activeTab}
            allTabHovered={allTabHovered}
            commentsTabHovered={commentsTabHovered}
            historyTabHovered={historyTabHovered}
            worklogTabHovered={worklogTabHovered}
            allTabProgress={allTabProgress}
            commentsTabProgress={commentsTabProgress}
            historyTabProgress={historyTabProgress}
            worklogTabProgress={worklogTabProgress}
            commentInputHovered={commentInputHovered}
            commentInputProgress={commentInputProgress}
            showFirstComment={showFirstComment}
            showSecondComment={showSecondComment}
            firstCommentSpring={firstCommentSpring}
            secondCommentSpring={secondCommentSpring}
          />
        </div>
      </div>

      {/* Sidebar - Right side */}
      <JiraSidebar
        x={contentWidth + sidebarOffsetX}
        y={headerHeight}
        width={sidebarWidth}
        height={contentHeight}
        statusButtonHovered={statusButtonHovered}
        improveTaskButtonHovered={improveTaskButtonHovered}
        statusButtonProgress={statusButtonProgress}
        improveTaskButtonProgress={improveTaskButtonProgress}
        assigneeState={assigneeState}
        assigneeDropdownProgress={assigneeDropdownProgress}
        typedText={typedText}
      />
    </div>
  );
};
