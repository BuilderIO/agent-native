/**
 * SlackUI - Main Slack interface layout
 */
import React from "react";
import { SlackTopHeader } from "./SlackTopHeader";
import { SlackLeftSidebar } from "./SlackLeftSidebar";
import { SlackMiddleSidebar } from "./SlackMiddleSidebar";
import { SlackMainContent } from "./SlackMainContent";
import { SlackThreadPanel } from "./SlackThreadPanel";

interface MentionOption {
  avatar: string;
  name: string;
  status?: string;
  type: "person" | "bot";
}

interface SlackUIProps {
  width: number;
  height: number;
  currentFrame?: number;
  // Hover states for interactive elements
  searchHoverProgress?: number;
  navHoverStates?: Record<string, number>;
  channelHoverStates?: Record<string, number>;
  dmHoverStates?: Record<string, number>;
  messageHoverStates?: Record<string, number>;
  builderButtonHoverProgress?: number;
  // Animation states
  threadPanelSlideProgress?: number;
  typedText?: string;
  showMentionPill?: boolean;
  mentionPillSpring?: number;
  showMentionAutocomplete?: boolean;
  showDiegoMessage?: boolean;
  mentionAutocompleteOpacity?: number;
  mentionAutocompleteOptions?: MentionOption[];
  mentionSearchTerm?: string;
  diegoMessageOpacity?: number;
  diegoMessageScale?: number;
  diegoMessageY?: number;
  showThreadIndicator?: boolean;
  threadIndicatorOpacity?: number;
  threadIndicatorHoverProgress?: number;
  existingMessagesY?: number;
}

export const SlackUI: React.FC<SlackUIProps> = ({
  width,
  height,
  currentFrame = 0,
  searchHoverProgress = 0,
  navHoverStates = {},
  channelHoverStates = {},
  dmHoverStates = {},
  messageHoverStates = {},
  builderButtonHoverProgress = 0,
  threadPanelSlideProgress = 0,
  typedText = "",
  showMentionPill = false,
  mentionPillSpring = 0,
  showMentionAutocomplete = false,
  showDiegoMessage = true,
  mentionAutocompleteOpacity = 0,
  mentionAutocompleteOptions = [],
  mentionSearchTerm = "",
  diegoMessageOpacity = 1,
  diegoMessageScale = 1,
  diegoMessageY = 0,
  showThreadIndicator = true,
  threadIndicatorOpacity = 1,
  threadIndicatorHoverProgress = 0,
  existingMessagesY = 0,
}) => {
  const topHeaderHeight = 55;
  const contentHeight = height - topHeaderHeight;
  const leftSidebarWidth = 100;
  const middleSidebarWidth = 380;
  const threadPanelWidth = 535;

  // Calculate thread panel width - starts at 0, grows to full width
  // Main content area automatically fills remaining space via flex
  const animatedThreadPanelWidth = threadPanelWidth * threadPanelSlideProgress;

  return (
    <div
      style={{
        width,
        height,
        borderRadius: 24,
        overflow: "hidden",
        background: "linear-gradient(126deg, #3d1142 2.15%, #250527 44.06%)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top Header */}
      <SlackTopHeader width={width} searchHoverProgress={searchHoverProgress} />

      {/* Main Content Area */}
      <div style={{ display: "flex", height: contentHeight }}>
        {/* Left Sidebar - Navigation */}
        <SlackLeftSidebar height={contentHeight} navHoverStates={navHoverStates} />

        {/* Middle Sidebar - Channels & DMs */}
        <SlackMiddleSidebar
          height={contentHeight}
          channelHoverStates={channelHoverStates}
          dmHoverStates={dmHoverStates}
        />

        {/* Main Content - Messages */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
          }}
        >
          <SlackMainContent
            width={width - leftSidebarWidth - middleSidebarWidth - animatedThreadPanelWidth}
            height={contentHeight}
            currentFrame={currentFrame}
            messageHoverStates={messageHoverStates}
            typedText={typedText}
            showMentionPill={showMentionPill}
            mentionPillSpring={mentionPillSpring}
            showMentionAutocomplete={showMentionAutocomplete}
            showDiegoMessage={showDiegoMessage}
            mentionAutocompleteOpacity={mentionAutocompleteOpacity}
            mentionAutocompleteOptions={mentionAutocompleteOptions}
            mentionSearchTerm={mentionSearchTerm}
            diegoMessageOpacity={diegoMessageOpacity}
            diegoMessageScale={diegoMessageScale}
            diegoMessageY={diegoMessageY}
            showThreadIndicator={showThreadIndicator}
            threadIndicatorOpacity={threadIndicatorOpacity}
            threadIndicatorHoverProgress={threadIndicatorHoverProgress}
            existingMessagesY={existingMessagesY}
          />
        </div>

        {/* Right Panel - Thread - Always present, width animates from 0 to full */}
        <div
          style={{
            width: animatedThreadPanelWidth,
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <SlackThreadPanel
            width={threadPanelWidth}
            height={contentHeight}
            builderButtonHoverProgress={builderButtonHoverProgress}
          />
        </div>
      </div>
    </div>
  );
};
