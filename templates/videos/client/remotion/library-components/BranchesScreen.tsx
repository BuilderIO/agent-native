/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BRANCHES SCREEN ORGANISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Complete branches screen layout combining the "What should we build?" prompt
 * and the branches Kanban board.
 *
 * Features:
 * - CreateProjectPrompt at the top
 * - BranchesKanbanView with tabs and board
 * - Full responsive layout
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import type { AnimationTrack } from "@/types";
import { CreateProjectPrompt } from "./CreateProjectPrompt";
import { BranchesKanbanView } from "./BranchesKanbanView";

export type BranchesScreenProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  tracks?: AnimationTrack[];
  promptHasText?: boolean;
  promptValue?: string;
  promptIsFocused?: boolean;
  showTypingCursor?: boolean;
  typingCursorBlink?: boolean;
  cogButtonIsHovered?: boolean;
  reactViteIsHovered?: boolean;
  oneXIsHovered?: boolean;
  buildButtonIsHovered?: boolean;
  sendButtonIsHovered?: boolean;
  sendButtonHoverProgress?: number;
  sendButtonIsClicking?: boolean;
  connectRepoIsHovered?: boolean;
  template1IsHovered?: boolean;
  template2IsHovered?: boolean;
  moreButtonIsHovered?: boolean;
  showDropdown?: boolean;
  dropdownX?: number;
  dropdownY?: number;
  githubProviderIsHovered?: boolean;
  azureProviderIsHovered?: boolean;
  gitlabProviderIsHovered?: boolean;
  bitbucketProviderIsHovered?: boolean;
};

export const BranchesScreen: React.FC<BranchesScreenProps> = (props) => {
  const {
    x = 0,
    y = 0,
    width = 1920,
    height = 1080,
    tracks = [],
    promptHasText = false,
    promptValue = "",
    promptIsFocused = false,
    showTypingCursor = false,
    typingCursorBlink = true,
    cogButtonIsHovered = false,
    reactViteIsHovered = false,
    oneXIsHovered = false,
    buildButtonIsHovered = false,
    sendButtonIsHovered = false,
    sendButtonHoverProgress = 0,
    sendButtonIsClicking = false,
    connectRepoIsHovered = false,
    template1IsHovered = false,
    template2IsHovered = false,
    moreButtonIsHovered = false,
    showDropdown = false,
    dropdownX = 0,
    dropdownY = 0,
    githubProviderIsHovered = false,
    azureProviderIsHovered = false,
    gitlabProviderIsHovered = false,
    bitbucketProviderIsHovered = false,
  } = props;

  // Generate unique ID for scrollbar styles
  const scrollbarId = React.useMemo(
    () => `scrollbar-${Math.random().toString(36).substr(2, 9)}`,
    []
  );

  return (
    <>
      {/* Custom scrollbar styles */}
      <style>{`
        .${scrollbarId}::-webkit-scrollbar {
          width: 12px;
        }
        .${scrollbarId}::-webkit-scrollbar-track {
          background: #191919;
          border-left: 1px solid #2a2a2a;
        }
        .${scrollbarId}::-webkit-scrollbar-thumb {
          background: #434343;
          border-radius: 6px;
          border: 2px solid #191919;
        }
        .${scrollbarId}::-webkit-scrollbar-thumb:hover {
          background: #5a5a5a;
        }
        .${scrollbarId} {
          scrollbar-width: thin;
          scrollbar-color: #434343 #191919;
        }
      `}</style>

      <div
        className={scrollbarId}
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: width,
          height: height,
          backgroundColor: "#1d1d1d",
          display: "flex",
          paddingLeft: 83,
          paddingRight: 83,
          paddingTop: 67,
          paddingBottom: 71,
          flexDirection: "column",
          overflow: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignSelf: "center",
            width: "100%",
            maxWidth: 1372,
          }}
        >
          {/* What should we build? Section */}
          <div style={{ alignSelf: "center" }}>
            <CreateProjectPrompt
              x={0}
              y={0}
              hasText={promptHasText}
              value={promptValue}
              isFocused={promptIsFocused}
              showTypingCursor={showTypingCursor}
              typingCursorBlink={typingCursorBlink}
              cogButtonIsHovered={cogButtonIsHovered}
              reactViteIsHovered={reactViteIsHovered}
              oneXIsHovered={oneXIsHovered}
              buildButtonIsHovered={buildButtonIsHovered}
              isHovered={sendButtonIsHovered}
              hoverProgress={sendButtonHoverProgress}
              isClicking={sendButtonIsClicking}
              connectRepoIsHovered={connectRepoIsHovered}
              template1IsHovered={template1IsHovered}
              template2IsHovered={template2IsHovered}
              moreButtonIsHovered={moreButtonIsHovered}
              showDropdown={showDropdown}
              dropdownX={dropdownX}
              dropdownY={dropdownY}
              githubProviderIsHovered={githubProviderIsHovered}
              azureProviderIsHovered={azureProviderIsHovered}
              gitlabProviderIsHovered={gitlabProviderIsHovered}
              bitbucketProviderIsHovered={bitbucketProviderIsHovered}
            />
          </div>

          {/* Branches Kanban View Section */}
          <div style={{ marginTop: 62 }}>
            <BranchesKanbanView x={0} y={0} width={1372} />
          </div>
        </div>
      </div>
    </>
  );
};
