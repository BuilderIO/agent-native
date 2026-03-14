/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROJECTS SCREEN ORGANISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Complete projects screen layout combining the "What should we build?" prompt
 * and the projects grid with multiple project cards.
 *
 * Features:
 * - CreateProjectPrompt at the top
 * - ProjectsView controls (tabs, search)
 * - Grid of ProjectCard components
 * - Full responsive layout
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import type { AnimationTrack } from "@/types";
import { CreateProjectPrompt } from "./CreateProjectPrompt";
import { ProjectsView } from "./ProjectsView";
import { ProjectCard } from "./ProjectCard";

export type ProjectsScreenProps = {
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

export const ProjectsScreen: React.FC<ProjectsScreenProps> = (props) => {
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
    connectRepoIsHovered = false,
    template1IsHovered = false,
    template2IsHovered = false,
    moreButtonIsHovered = false,
    sendButtonHoverProgress = 0,
    sendButtonIsClicking = false,
    showDropdown = false,
    dropdownX = 0,
    dropdownY = 0,
    githubProviderIsHovered = false,
    azureProviderIsHovered = false,
    gitlabProviderIsHovered = false,
    bitbucketProviderIsHovered = false,
  } = props;

  // Generate unique ID for scrollbar styles
  const scrollbarId = React.useMemo(() => `scrollbar-${Math.random().toString(36).substr(2, 9)}`, []);

  // Project data
  const projects = [
    {
      projectName: "sales-dash",
      lastEdited: "Edited 3hr ago",
      previewImage:
        "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/47e7939cce14e436f6a642c4d9bc854b51921c30?placeholderIfAbsent=true",
      avatarImage:
        "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e00c7e415a248072007c7a09a2bc933347e5f3c7?placeholderIfAbsent=true",
      branches: [
        {
          name: "add-top-sources",
          timeAgo: "3 hr ago",
          avatarImage:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2b536ddd59099ee76d316a7dac1a2e30add8da48?placeholderIfAbsent=true",
          statusIcon:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/27e05e8e75ad8b8ffb335fdc8efc1248596e26aa?placeholderIfAbsent=true",
        },
        {
          name: "register-components",
          timeAgo: "5 hr ago",
          avatarImage:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9abb9bfd27065db5f2e84a5000a196098c2adb20?placeholderIfAbsent=true",
          statusIcon:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/0fb587208661e0859816cbdf05a8517bfceca602?placeholderIfAbsent=true",
        },
      ],
    },
    {
      projectName: "marketing-site",
      lastEdited: "Last edited about 3 hours ago",
      previewImage:
        "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/11e1d8a625d22d8a3618300c0fca67bbad85d414?placeholderIfAbsent=true",
      avatarImage:
        "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/143298e989894307a9353e4975ccd1ce3e5f6ba1?placeholderIfAbsent=true",
      branches: [
        {
          name: "add-design-tokens",
          timeAgo: "19 min ago",
          avatarImage:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9159f7fca57caa283d6a1e47050a53704d362c42?placeholderIfAbsent=true",
          statusIcon:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/c078a5fe08c42473ba61b291b0038e2567b7aaba?placeholderIfAbsent=true",
        },
        {
          name: "expand-component-library",
          timeAgo: "6 hr ago",
          avatarImage:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/72f041cdbacfce44eecf38f259cbeca821b6fe1a?placeholderIfAbsent=true",
          statusIcon:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/acb262801af0fc4fc694d946b37361e473a1a995?placeholderIfAbsent=true",
        },
      ],
    },
    {
      projectName: "product",
      lastEdited: "Last edited about 3 hours ago",
      previewImage:
        "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/700da3b6abcc6a02ae33dd10f39e418bec38afa2?placeholderIfAbsent=true",
      avatarImage:
        "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/255c4528d9f197b60d5c6753190a535dbbf80af9?placeholderIfAbsent=true",
      branches: [
        {
          name: "fix broken alerts",
          timeAgo: "8 min ago",
          avatarImage:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9159f7fca57caa283d6a1e47050a53704d362c42?placeholderIfAbsent=true",
          statusIcon:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ee0c8febbf76f5b270c3f0aa521158c99f892528?placeholderIfAbsent=true",
        },
        {
          name: "add-goals",
          timeAgo: "3 days ago",
          avatarImage:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/28e6a70862a8ee52a12571d9c661ce9bd23f6b33?placeholderIfAbsent=true",
          statusIcon:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/6d1bd3ca38000a7ebd0f989c6c634315065d0e30?placeholderIfAbsent=true",
        },
      ],
    },
    {
      projectName: "ai-services",
      lastEdited: "Edited 24min ago",
      previewImage:
        "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5c9ff93a8d3da83db2ed3853b0a52563bf7a21c8?placeholderIfAbsent=true",
      avatarImage:
        "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/3b0b463350058bbec8f9d6b613cc3dc6b53114bc?placeholderIfAbsent=true",
      branches: [
        {
          name: "daisy-flow",
          timeAgo: "24 min ago",
          avatarImage:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/be590c068c086cb4645812668f2616eb63258c44?placeholderIfAbsent=true",
          statusIcon:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ee0c8febbf76f5b270c3f0aa521158c99f892528?placeholderIfAbsent=true",
        },
        {
          name: "change-agent",
          timeAgo: "9 days ago",
          avatarImage:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2b536ddd59099ee76d316a7dac1a2e30add8da48?placeholderIfAbsent=true",
          statusIcon:
            "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/6d1bd3ca38000a7ebd0f989c6c634315065d0e30?placeholderIfAbsent=true",
        },
      ],
    },
  ];

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
        {/* What should we build? Section - using composed component with x=0, y=0 for relative positioning */}
        <div
          style={{
            alignSelf: "center",
          }}
        >
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

        {/* Projects View Section */}
        <div style={{ marginTop: 62 }}>
          <ProjectsView x={0} y={0} width={1372} activeTab="Projects" />

          {/* Projects Grid - using composed components with x=0, y=0 for relative positioning */}
          <div
            style={{
              display: "flex",
              marginTop: 42,
              gap: 24,
              flexWrap: "wrap",
              justifyContent: "space-between",
            }}
          >
            {projects.map((project, index) => (
              <ProjectCard
                key={index}
                x={0}
                y={0}
                projectName={project.projectName}
                lastEdited={project.lastEdited}
                previewImage={project.previewImage}
                avatarImage={project.avatarImage}
                branches={project.branches}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

// Preview composition with constrained width
export const ProjectsScreenPreview = createInteractiveComposition({
  component: ProjectsScreen,
  width: 1920,
  height: 1080,
  durationInFrames: 150,
  fps: 30,
  tracks: [],
  defaultProps: {
    x: 0,
    y: 0,
  },
});
