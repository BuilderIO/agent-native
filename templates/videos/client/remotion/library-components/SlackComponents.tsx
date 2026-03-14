/**
 * Interactive Slack Components for Component Library
 * These are wrapper versions that add useInteractiveComponent registration
 */
import React from "react";
import { useCurrentFrame, useVideoConfig, AbsoluteFill } from "remotion";
import { useInteractiveComponent, AnimationPresets } from "../hooks/useInteractiveComponent";
import { useCursorHistory } from "../hooks/useCursorHistory";
import { findTrack } from "../trackAnimation";
import type { AnimationTrack } from "@/types";
import {
  SlackSearchInput as BaseSlackSearchInput,
  SlackNavItem as BaseSlackNavItem,
  SlackChannelItem as BaseSlackChannelItem,
  SlackDMItem as BaseSlackDMItem,
  SlackMessageCard as BaseSlackMessageCard,
  SlackTopHeader as BaseSlackTopHeader,
  SlackLeftSidebar as BaseSlackLeftSidebar,
  SlackMiddleSidebar as BaseSlackMiddleSidebar,
  SlackMainContent as BaseSlackMainContent,
  SlackThreadPanel as BaseSlackThreadPanel,
  SlackUI as BaseSlackUI,
} from "../slack-components";

interface InteractiveSlackComponentProps {
  tracks?: AnimationTrack[];
  debugMode?: boolean;
}

// Debug zone visualization component
const DebugZone: React.FC<{ zone: { x: number; y: number; width: number; height: number }, label: string }> = ({ zone, label }) => (
  <div
    style={{
      position: "absolute",
      left: zone.x,
      top: zone.y,
      width: zone.width,
      height: zone.height,
      border: "2px solid rgba(255, 0, 0, 0.8)",
      backgroundColor: "rgba(255, 0, 0, 0.1)",
      pointerEvents: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 10,
      color: "rgba(255, 255, 255, 0.9)",
      fontWeight: "bold",
      textShadow: "0 0 4px rgba(0,0,0,0.8)",
    }}
  >
    {label}
  </div>
);

export const SlackSearchInput: React.FC<InteractiveSlackComponentProps> = ({ tracks = [], debugMode = false }) => {
  const { width, height } = useVideoConfig();
  const cursorTrack = findTrack(tracks, "cursor", tracks[1]);
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  const zone = { x: (width - 660) / 2, y: (height - 40) / 2, width: 660, height: 40 };

  const searchBar = useInteractiveComponent({
    id: "search-input",
    elementType: "Input",
    label: "Search Input",
    compositionId: "slack-search-input",
    zone,
    cursorHistory,
    interactiveElementType: "input",
    hoverAnimation: AnimationPresets.scaleHover(0.02),
  });

  React.useEffect(() => {}, [searchBar.hover.isHovering]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <div style={{ position: "absolute", left: zone.x, top: zone.y }}>
        <BaseSlackSearchInput width={660} hoverProgress={searchBar.hover.progress} />
      </div>
      {debugMode && <DebugZone zone={zone} label="Search Input" />}
    </AbsoluteFill>
  );
};

export const SlackNavItem: React.FC<InteractiveSlackComponentProps> = ({ tracks = [], debugMode = false }) => {
  const { width, height } = useVideoConfig();
  const cursorTrack = findTrack(tracks, "cursor", tracks[1]);
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  const zone = { x: (width - 80) / 2, y: (height - 100) / 2, width: 80, height: 100 };

  const navItem = useInteractiveComponent({
    id: "nav-item",
    elementType: "Button",
    label: "Home Nav",
    compositionId: "slack-nav-item",
    zone,
    cursorHistory,
    interactiveElementType: "button",
    hoverAnimation: AnimationPresets.scaleHover(0.05),
  });

  React.useEffect(() => {}, [navItem.hover.isHovering]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <div style={{ position: "absolute", left: zone.x, top: zone.y }}>
        <BaseSlackNavItem
          icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9373ffc5818d27d9209df837578bf8fcb54420c1"
          label="Home"
          isActive={true}
          hoverProgress={navItem.hover.progress}
        />
      </div>
      {debugMode && <DebugZone zone={zone} label="Nav Item" />}
    </AbsoluteFill>
  );
};

export const SlackChannelItem: React.FC<InteractiveSlackComponentProps> = ({ tracks = [], debugMode = false }) => {
  const { width, height } = useVideoConfig();
  const cursorTrack = findTrack(tracks, "cursor", tracks[1]);
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  const zone = { x: (width - 280) / 2, y: (height - 38) / 2, width: 280, height: 38 };

  const channelItem = useInteractiveComponent({
    id: "channel-item",
    elementType: "Button",
    label: "Channel Item",
    compositionId: "slack-channel-item",
    zone,
    cursorHistory,
    interactiveElementType: "button",
    hoverAnimation: AnimationPresets.scaleHover(0.02),
  });

  React.useEffect(() => {}, [channelItem.hover.isHovering]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <div style={{ position: "absolute", left: zone.x, top: zone.y, width: zone.width }}>
        <BaseSlackChannelItem
          icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9347f54e1f68efe048dd55867511b18da39a18a4"
          name="product-dev"
          hoverProgress={channelItem.hover.progress}
        />
      </div>
      {debugMode && <DebugZone zone={zone} label="Channel Item" />}
    </AbsoluteFill>
  );
};

export const SlackDMItem: React.FC<InteractiveSlackComponentProps> = ({ tracks = [], debugMode = false }) => {
  const { width, height } = useVideoConfig();
  const cursorTrack = findTrack(tracks, "cursor", tracks[1]);
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  const zone = { x: (width - 280) / 2, y: (height - 38) / 2, width: 280, height: 38 };

  const dmItem = useInteractiveComponent({
    id: "dm-item",
    elementType: "Button",
    label: "DM Item",
    compositionId: "slack-dm-item",
    zone,
    cursorHistory,
    interactiveElementType: "button",
    hoverAnimation: AnimationPresets.scaleHover(0.02),
  });

  React.useEffect(() => {}, [dmItem.hover.isHovering]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <div style={{ position: "absolute", left: zone.x, top: zone.y, width: zone.width }}>
        <BaseSlackDMItem
          avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/151a7d6433e4c148d7b8654cde84721864e79b7f"
          name="Amelia Gordon 🍎"
          hoverProgress={dmItem.hover.progress}
        />
      </div>
      {debugMode && <DebugZone zone={zone} label="DM Item" />}
    </AbsoluteFill>
  );
};

export const SlackMessageCard: React.FC<InteractiveSlackComponentProps> = ({ tracks = [], debugMode = false }) => {
  const { width, height } = useVideoConfig();
  const cursorTrack = findTrack(tracks, "cursor", tracks[1]);
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  const zone = { x: (width - 800) / 2, y: (height - 200) / 2, width: 800, height: 200 };

  const messageCard = useInteractiveComponent({
    id: "message-card",
    elementType: "Card",
    label: "Message Card",
    compositionId: "slack-message-card",
    zone,
    cursorHistory,
    interactiveElementType: "card",
    hoverAnimation: AnimationPresets.scaleHover(0.01),
  });

  React.useEffect(() => {}, [messageCard.hover.isHovering]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <div style={{ position: "absolute", left: zone.x, top: zone.y, width: zone.width }}>
        <BaseSlackMessageCard
          avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/151a7d6433e4c148d7b8654cde84721864e79b7f"
          author="Amelia Gordon 🍎"
          timestamp="Feb. 11th at 10:24 AM"
          content="Yesterday our dev team launched a new feature for users who needed to migrate their accounts from the old infrastructure. We are seeing massive performance improvements, up 23%. Thanks team! 🎉"
          reactions={[
            { emoji: "🎉", count: 2 },
            { emoji: "🔥", count: 3 },
          ]}
          threadReplies={4}
          threadPreview="Last reply 5hr ago"
          hoverProgress={messageCard.hover.progress}
        />
      </div>
      {debugMode && <DebugZone zone={zone} label="Message Card" />}
    </AbsoluteFill>
  );
};

export const SlackTopHeader: React.FC<InteractiveSlackComponentProps> = ({ tracks = [], debugMode = false }) => {
  const { width } = useVideoConfig();
  const cursorTrack = findTrack(tracks, "cursor", tracks[1]);
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  const zone = { x: (width - 660) / 2, y: 12, width: 660, height: 40 };

  const searchBar = useInteractiveComponent({
    id: "top-header-search",
    elementType: "Input",
    label: "Search Bar",
    compositionId: "slack-top-header",
    zone,
    cursorHistory,
    interactiveElementType: "input",
    hoverAnimation: AnimationPresets.scaleHover(0.02),
  });

  React.useEffect(() => {}, [searchBar.hover.isHovering]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <BaseSlackTopHeader width={width} searchHoverProgress={searchBar.hover.progress} />
      {debugMode && <DebugZone zone={zone} label="Search Bar" />}
    </AbsoluteFill>
  );
};

export const SlackLeftSidebar: React.FC<InteractiveSlackComponentProps> = ({ tracks = [], debugMode = false }) => {
  const { height } = useVideoConfig();
  const cursorTrack = findTrack(tracks, "cursor", tracks[1]);
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  // Define zones for nav items
  const homeZone = { x: 22, y: 100, width: 56, height: 85 };
  const dmsZone = { x: 22, y: 242, width: 56, height: 85 };
  const activityZone = { x: 22, y: 384, width: 56, height: 85 };

  // Register multiple nav items
  const homeNav = useInteractiveComponent({
    id: "nav-home",
    elementType: "Button",
    label: "Home",
    compositionId: "slack-left-sidebar",
    zone: homeZone,
    cursorHistory,
    interactiveElementType: "button",
    hoverAnimation: AnimationPresets.scaleHover(0.05),
  });

  const dmsNav = useInteractiveComponent({
    id: "nav-dms",
    elementType: "Button",
    label: "DMs",
    compositionId: "slack-left-sidebar",
    zone: dmsZone,
    cursorHistory,
    interactiveElementType: "button",
    hoverAnimation: AnimationPresets.scaleHover(0.05),
  });

  const activityNav = useInteractiveComponent({
    id: "nav-activity",
    elementType: "Button",
    label: "Activity",
    compositionId: "slack-left-sidebar",
    zone: activityZone,
    cursorHistory,
    interactiveElementType: "button",
    hoverAnimation: AnimationPresets.scaleHover(0.05),
  });

  React.useEffect(() => {}, [homeNav.hover.isHovering, dmsNav.hover.isHovering, activityNav.hover.isHovering]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <BaseSlackLeftSidebar
        height={height}
        activeNav="home"
        navHoverStates={{
          home: homeNav.hover.progress,
          dms: dmsNav.hover.progress,
          activity: activityNav.hover.progress,
        }}
      />
      {debugMode && (
        <>
          <DebugZone zone={homeZone} label="Home" />
          <DebugZone zone={dmsZone} label="DMs" />
          <DebugZone zone={activityZone} label="Activity" />
        </>
      )}
    </AbsoluteFill>
  );
};

export const SlackMiddleSidebar: React.FC<InteractiveSlackComponentProps> = ({ tracks = [], debugMode = false }) => {
  const { height } = useVideoConfig();
  const cursorTrack = findTrack(tracks, "cursor", tracks[1]);
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  const channelZone = { x: 127, y: 395, width: 250, height: 38 };
  const dmZone = { x: 127, y: 570, width: 250, height: 38 };

  const productDevChannel = useInteractiveComponent({
    id: "channel-product-dev",
    elementType: "Button",
    label: "product-dev",
    compositionId: "slack-middle-sidebar",
    zone: channelZone,
    cursorHistory,
    interactiveElementType: "button",
    hoverAnimation: AnimationPresets.scaleHover(0.02),
  });

  const ameliaDM = useInteractiveComponent({
    id: "dm-amelia",
    elementType: "Button",
    label: "Amelia",
    compositionId: "slack-middle-sidebar",
    zone: dmZone,
    cursorHistory,
    interactiveElementType: "button",
    hoverAnimation: AnimationPresets.scaleHover(0.02),
  });

  React.useEffect(() => {}, [productDevChannel.hover.isHovering, ameliaDM.hover.isHovering]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <div style={{ position: "absolute", left: 100, top: 0 }}>
        <BaseSlackMiddleSidebar
          height={height}
          channelHoverStates={{
            "product-dev": productDevChannel.hover.progress,
          }}
          dmHoverStates={{
            amelia: ameliaDM.hover.progress,
          }}
        />
      </div>
      {debugMode && (
        <>
          <DebugZone zone={channelZone} label="Channel: product-dev" />
          <DebugZone zone={dmZone} label="DM: Amelia" />
        </>
      )}
    </AbsoluteFill>
  );
};

export const SlackMainContent: React.FC<InteractiveSlackComponentProps> = ({ tracks = [], debugMode = false }) => {
  const cursorTrack = findTrack(tracks, "cursor", tracks[1]);
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  const messageZone = { x: 580, y: 200, width: 760, height: 180 };

  const message1 = useInteractiveComponent({
    id: "message-1",
    elementType: "Card",
    label: "Message 1",
    compositionId: "slack-main-content",
    zone: messageZone,
    cursorHistory,
    interactiveElementType: "card",
    hoverAnimation: AnimationPresets.scaleHover(0.01),
  });

  React.useEffect(() => {}, [message1.hover.isHovering]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <div style={{ position: "absolute", left: 480, top: 0 }}>
        <BaseSlackMainContent
          width={900}
          height={1080}
          messageHoverStates={{
            msg1: message1.hover.progress,
          }}
        />
      </div>
      {debugMode && <DebugZone zone={messageZone} label="Message" />}
    </AbsoluteFill>
  );
};

export const SlackThreadPanel: React.FC<InteractiveSlackComponentProps> = ({ tracks = [], debugMode = false }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <div style={{ position: "absolute", left: 1385, top: 0 }}>
        <BaseSlackThreadPanel width={535} height={1080} />
        {/* No interactive zones in thread panel for now */}
      </div>
    </AbsoluteFill>
  );
};

export const SlackUI: React.FC<InteractiveSlackComponentProps> = ({ tracks = [], debugMode = false }) => {
  const { width, height } = useVideoConfig();
  const cursorTrack = findTrack(tracks, "cursor", tracks[1]);
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  // Define zones for key interactive elements
  const searchZone = { x: width / 2 - 330, y: 12, width: 660, height: 40 };
  const homeNavZone = { x: 22, y: 165, width: 56, height: 85 };

  // Register a few key interactive elements
  const searchBar = useInteractiveComponent({
    id: "search-bar",
    elementType: "Input",
    label: "Search",
    compositionId: "slack-ui",
    zone: searchZone,
    cursorHistory,
    interactiveElementType: "input",
    hoverAnimation: AnimationPresets.scaleHover(0.02),
  });

  const homeNav = useInteractiveComponent({
    id: "nav-home",
    elementType: "Button",
    label: "Home Nav",
    compositionId: "slack-ui",
    zone: homeNavZone,
    cursorHistory,
    interactiveElementType: "button",
    hoverAnimation: AnimationPresets.scaleHover(0.05),
  });

  React.useEffect(() => {}, [searchBar.hover.isHovering, homeNav.hover.isHovering]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <BaseSlackUI
        width={width}
        height={height}
        searchHoverProgress={searchBar.hover.progress}
        navHoverStates={{
          home: homeNav.hover.progress,
        }}
        channelHoverStates={{}}
        dmHoverStates={{}}
        messageHoverStates={{}}
      />
      {debugMode && (
        <>
          <DebugZone zone={searchZone} label="Search" />
          <DebugZone zone={homeNavZone} label="Home Nav" />
        </>
      )}
    </AbsoluteFill>
  );
};
