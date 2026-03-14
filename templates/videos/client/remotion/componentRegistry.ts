/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPONENT LIBRARY REGISTRY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file defines all reusable UI components that can be imported into
 * compositions. Each component has a 5-second preview with cursor interactions.
 *
 * Components are designed to be:
 * - Importable in Studio compositions
 * - Testable with cursor interactions
 * - Documented with props and animations
 * - Reusable across multiple compositions
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type React from "react";
import type { AnimationTrack } from "@/types";
import {
  Card, type CardProps,
  Button, type ButtonProps,
  CodePanel, type CodePanelProps,
  StandardSidebar, type StandardSidebarProps,
  ProjectsSidebar, type ProjectsSidebarProps,
  ProjectsScreen, type ProjectsScreenProps,
  ProjectsLayout, type ProjectsLayoutProps,
  CreateProjectPrompt, type CreateProjectPromptProps,
  ProjectsView, type ProjectsViewProps,
  ProjectCard, type ProjectCardProps,
  SecondaryButton, type SecondaryButtonProps,
  PrimaryButton, type PrimaryButtonProps,
  SectionHeader, type SectionHeaderProps,
  FileItem, type FileItemProps,
  FolderItem, type FolderItemProps,
  // Slack Components (Interactive Wrappers)
  SlackSearchInput,
  SlackNavItem,
  SlackChannelItem,
  SlackDMItem,
  SlackMessageCard,
  SlackTopHeader,
  SlackLeftSidebar,
  SlackMiddleSidebar,
  SlackMainContent,
  SlackThreadPanel,
  SlackUI,
} from "./library-components";
import { createCameraTrack, createCursorTrack } from "./trackHelpers";

/**
 * Standard 5-second component preview cursor track (150 frames @ 30fps).
 * Timeline: arrive at 0.5s, hover, click at 2s, exit at 3.5s
 */
function makePreviewCursorTrack(
  cx: number,
  cy: number,
  opts: { clickFrame?: number; fadeOpacity?: boolean } = {}
): AnimationTrack {
  const { clickFrame = 60, fadeOpacity = false } = opts;
  const track = createCursorTrack(150, { startX: 200, startY: 200 });

  track.animatedProps.find(p => p.property === "x")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: String(cx) },  // Arrive at 0.5s
    { frame: 90, value: String(cx) },  // Stay
    { frame: 120, value: "1720" },
    { frame: 150, value: "1720" },
  ];
  track.animatedProps.find(p => p.property === "y")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: String(cy) },
    { frame: 90, value: String(cy) },
    { frame: 120, value: "200" },
    { frame: 150, value: "200" },
  ];
  track.animatedProps.find(p => p.property === "isClicking")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: clickFrame - 1, value: "0" },
    { frame: clickFrame, value: "1" },
    { frame: clickFrame + 10, value: "0" },
    { frame: 150, value: "0" },
  ];
  if (fadeOpacity) {
    track.animatedProps.find(p => p.property === "opacity")!.keyframes = [
      { frame: 0, value: "0" },
      { frame: 5, value: "0" },
      { frame: 15, value: "1" },
      { frame: 90, value: "1" },
      { frame: 100, value: "0" },
      { frame: 150, value: "0" },
    ];
  }
  // type stays "default" — autoCursorType handles pointer-on-hover automatically
  return track;
}

/**
 * Defines a prop for UI documentation
 */
export interface PropDefinition {
  name: string;
  type: string;
  defaultValue: any;
  description?: string;
}

/**
 * Component categories following atomic design principles:
 *
 * - **Atoms**: Basic building blocks that can't be broken down further
 *   Examples: Button, Input, Icon, Label, Badge
 *
 * - **Molecules**: Simple combinations of atoms functioning together
 *   Examples: Search bar (input + button), Form field (label + input), Card header
 *
 * - **Organisms**: Complex UI components made of molecules and/or atoms
 *   Examples: Navigation bar, Form, Card, Modal, Sidebar
 *
 * - **Templates**: Page-level layouts that define structure
 *   Examples: Dashboard layout, Article layout, Admin panel layout
 *
 * - **Pages**: Specific instances of templates with real content
 *   Examples: Home page, Profile page, Settings page
 */
export type ComponentCategory =
  | "Atoms"
  | "Molecules"
  | "Organisms"
  | "Templates"
  | "Pages";

/**
 * Component library entry - defines a reusable component with its metadata
 */
export interface LibraryComponentEntry {
  /** Unique identifier for the component */
  id: string;
  /** Display name */
  title: string;
  /** Short description of what the component does */
  description: string;
  /** Atomic design category */
  category: ComponentCategory;
  /** The React component to render */
  component: React.ComponentType<any>;
  /** Default props passed to the component */
  defaultProps: Record<string, any>;
  /** Prop definitions for documentation */
  propTypes: PropDefinition[];
  /** Default tracks (cursor + animations) for the 5-second preview */
  tracks: AnimationTrack[];
  /** Fixed at 150 frames (5 seconds @ 30fps) */
  durationInFrames: number;
  /** Frame rate */
  fps: number;
  /** Canvas width */
  width: number;
  /** Canvas height */
  height: number;
}

/**
 * Component library registry - all available components
 */
export const libraryComponents: LibraryComponentEntry[] = [
  {
    id: "card",
    title: "Card",
    description: "A simple interactive card component with text content. Demonstrates hover and click animations.",
    category: "Organisms",
    component: Card,
    defaultProps: {
      title: "Interactive Card",
      description: "Hover over me to see the scale animation. Click to see the press effect!",
      backgroundColor: "#1e293b",
      textColor: "#f1f5f9",
    },
    propTypes: [
      {
        name: "title",
        type: "string",
        defaultValue: "Card Title",
        description: "The title text displayed on the card",
      },
      {
        name: "description",
        type: "string",
        defaultValue: "This is a card component with hover and click animations.",
        description: "The description text displayed below the title",
      },
      {
        name: "backgroundColor",
        type: "string",
        defaultValue: "#1e293b",
        description: "The background color of the card",
      },
      {
        name: "textColor",
        type: "string",
        defaultValue: "#f1f5f9",
        description: "The text color for title and description",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(1920 / 2 - 16, 1080 / 2 - 16),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "button",
    title: "Button",
    description: "An interactive button component. Demonstrates hover and click animations with scale and brightness effects.",
    category: "Atoms",
    component: Button,
    defaultProps: {
      label: "Click Me",
      backgroundColor: "#3b82f6",
      textColor: "#ffffff",
    },
    propTypes: [
      {
        name: "label",
        type: "string",
        defaultValue: "Click Me",
        description: "The text displayed on the button",
      },
      {
        name: "backgroundColor",
        type: "string",
        defaultValue: "#3b82f6",
        description: "The background color of the button",
      },
      {
        name: "textColor",
        type: "string",
        defaultValue: "#ffffff",
        description: "The text color of the button label",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(1920 / 2 - 16, 1080 / 2 - 16, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "secondary-button",
    title: "Secondary Button",
    description: "An outline-style button with optional icon. Used for secondary actions like Share or Cancel buttons.",
    category: "Atoms",
    component: SecondaryButton,
    defaultProps: {
      label: "Share",
      icon: "🔗",
      x: 860,
      y: 524,
      backgroundColor: "#2a2a2a",
      borderColor: "#393939",
      textColor: "#ffffff",
    },
    propTypes: [
      {
        name: "label",
        type: "string",
        defaultValue: "Share",
        description: "The button label text",
      },
      {
        name: "icon",
        type: "string",
        defaultValue: "🔗",
        description: "Optional icon (emoji or character)",
      },
      {
        name: "backgroundColor",
        type: "string",
        defaultValue: "#2a2a2a",
        description: "Button background color",
      },
      {
        name: "borderColor",
        type: "string",
        defaultValue: "#393939",
        description: "Button border color",
      },
      {
        name: "textColor",
        type: "string",
        defaultValue: "#ffffff",
        description: "Button text color",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960 - 16, 540 - 16, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "primary-button",
    title: "Primary Button",
    description: "A solid background button with optional icon. Used for primary CTAs like Send PR or Push to Remote.",
    category: "Atoms",
    component: PrimaryButton,
    defaultProps: {
      label: "Send PR",
      icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/81e7eb620e52aae529258200f6dff2cc38027cd8?placeholderIfAbsent=true",
      x: 860,
      y: 524,
      width: 82,
      height: 32,
      backgroundColor: "#48a1ff",
      textColor: "#000000",
    },
    propTypes: [
      {
        name: "label",
        type: "string",
        defaultValue: "Send PR",
        description: "The button label text",
      },
      {
        name: "icon",
        type: "string",
        defaultValue: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/81e7eb620e52aae529258200f6dff2cc38027cd8?placeholderIfAbsent=true",
        description: "Optional icon image URL",
      },
      {
        name: "width",
        type: "number",
        defaultValue: 82,
        description: "Button width in pixels",
      },
      {
        name: "height",
        type: "number",
        defaultValue: 32,
        description: "Button height in pixels",
      },
      {
        name: "backgroundColor",
        type: "string",
        defaultValue: "#48a1ff",
        description: "Button background color",
      },
      {
        name: "textColor",
        type: "string",
        defaultValue: "#000000",
        description: "Button text color",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960 - 16, 540 - 16, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "section-header",
    title: "Section Header",
    description: "A section header with icon and uppercase text. Used for consistent labeling like ALL CHANGES, ALL FILES, etc.",
    category: "Atoms",
    component: SectionHeader,
    defaultProps: {
      icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f872b16106ef6bbaea80fcefece2392325659d2c?placeholderIfAbsent=true",
      iconWidth: 14,
      label: "ALL CHANGES",
      x: 760,
      y: 528,
    },
    propTypes: [
      {
        name: "icon",
        type: "string",
        defaultValue: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f872b16106ef6bbaea80fcefece2392325659d2c?placeholderIfAbsent=true",
        description: "Icon image URL",
      },
      {
        name: "iconWidth",
        type: "number",
        defaultValue: 14,
        description: "Icon width in pixels",
      },
      {
        name: "label",
        type: "string",
        defaultValue: "ALL CHANGES",
        description: "Section label text (will be uppercase)",
      },
      {
        name: "chevron",
        type: "string",
        defaultValue: "",
        description: "Optional chevron/dropdown icon URL",
      },
      {
        name: "chevronWidth",
        type: "number",
        defaultValue: 12,
        description: "Chevron icon width in pixels",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960 - 16, 540 - 16, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "file-item",
    title: "File Item",
    description: "A file list item with icon, name, line count badge, and file path. Demonstrates hover brightness effect.",
    category: "Atoms",
    component: FileItem,
    defaultProps: {
      icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/10ff8b681a169f3c2b0c90b4fd672a0e7173771b?placeholderIfAbsent=true",
      name: "KineticText.tsx",
      lineCount: "+ 42",
      path: "client/remotion/compositions",
      x: 760,
      y: 528,
    },
    propTypes: [
      {
        name: "icon",
        type: "string",
        defaultValue: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/10ff8b681a169f3c2b0c90b4fd672a0e7173771b?placeholderIfAbsent=true",
        description: "File type icon image URL",
      },
      {
        name: "name",
        type: "string",
        defaultValue: "KineticText.tsx",
        description: "File name",
      },
      {
        name: "lineCount",
        type: "string",
        defaultValue: "+ 42",
        description: "Lines added/changed",
      },
      {
        name: "path",
        type: "string",
        defaultValue: "client/remotion/compositions",
        description: "File path",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(890, 540, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "folder-item",
    title: "Folder Item",
    description: "A collapsible folder item with chevron and folder icon. Used in file explorer trees.",
    category: "Atoms",
    component: FolderItem,
    defaultProps: {
      name: "client",
      isExpanded: true,
      x: 760,
      y: 528,
    },
    propTypes: [
      {
        name: "name",
        type: "string",
        defaultValue: "client",
        description: "Folder name",
      },
      {
        name: "isExpanded",
        type: "boolean",
        defaultValue: true,
        description: "Whether the folder is expanded",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(890, 540, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "code-panel",
    title: "Code Panel",
    description: "A complete code explorer panel showing file changes and project structure. Demonstrates atomic design composition with interactive file items, folders, and action buttons.",
    category: "Organisms",
    component: CodePanel,
    defaultProps: {
      backgroundColor: "#1a1a1a",
    },
    propTypes: [
      {
        name: "backgroundColor",
        type: "string",
        defaultValue: "#1a1a1a",
        description: "The background color of the panel",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(180, 200, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "standard-sidebar",
    title: "Standard Sidebar",
    description: "A vertical navigation sidebar showing top-level application routes like /projects, /content, and /assets. Demonstrates Builder.io navigation patterns.",
    category: "Organisms",
    component: StandardSidebar,
    defaultProps: {
      backgroundColor: "#191919",
      x: 50,
      y: 0,
    },
    propTypes: [
      {
        name: "backgroundColor",
        type: "string",
        defaultValue: "#191919",
        description: "Sidebar background color",
      },
      {
        name: "x",
        type: "number",
        defaultValue: 50,
        description: "Horizontal position",
      },
      {
        name: "y",
        type: "number",
        defaultValue: 0,
        description: "Vertical position",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(60, 200, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "projects-sidebar",
    title: "Projects Sidebar",
    description: "A vertical navigation sidebar for the Projects tool. Demonstrates selected state with larger, rounded icon and right border.",
    category: "Organisms",
    component: ProjectsSidebar,
    defaultProps: {
      backgroundColor: "#191919",
      x: 50,
      y: 0,
    },
    propTypes: [
      {
        name: "backgroundColor",
        type: "string",
        defaultValue: "#191919",
        description: "Sidebar background color",
      },
      {
        name: "x",
        type: "number",
        defaultValue: 50,
        description: "Horizontal position",
      },
      {
        name: "y",
        type: "number",
        defaultValue: 0,
        description: "Vertical position",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(60, 150, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "project-card",
    title: "Project Card",
    description: "A card displaying project information including preview, branches, and actions. Shows project name, last edited time, branch list with avatars and status icons.",
    category: "Molecules",
    component: ProjectCard,
    defaultProps: {
      x: 811,
      y: 150,
      projectName: "sales-dash",
      lastEdited: "Edited 3hr ago",
    },
    propTypes: [
      {
        name: "projectName",
        type: "string",
        defaultValue: "sales-dash",
        description: "Project name",
      },
      {
        name: "lastEdited",
        type: "string",
        defaultValue: "Edited 3hr ago",
        description: "Last edited timestamp",
      },
      {
        name: "previewImage",
        type: "string",
        defaultValue: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/47e7939cce14e436f6a642c4d9bc854b51921c30?placeholderIfAbsent=true",
        description: "Project preview/thumbnail image URL",
      },
      {
        name: "width",
        type: "number",
        defaultValue: 298,
        description: "Card width in pixels",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960, 300, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "create-project-prompt",
    title: "Create Project Prompt",
    description: "The 'What should we build?' prompt section with template selection and creation controls. Includes Ask Builder input, framework selector, and action buttons.",
    category: "Organisms",
    component: CreateProjectPrompt,
    defaultProps: {
      x: 565,
      y: 169,
      width: 790,
    },
    propTypes: [
      {
        name: "width",
        type: "number",
        defaultValue: 790,
        description: "Component width in pixels (matches composition)",
      },
      {
        name: "x",
        type: "number",
        defaultValue: 565,
        description: "Horizontal position",
      },
      {
        name: "y",
        type: "number",
        defaultValue: 169,
        description: "Vertical position",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960, 150, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "projects-view",
    title: "Projects View",
    description: "The main projects list view controls with tabs, search, and grid/list toggle. Includes Projects/Branches/Pull Requests tabs and search functionality.",
    category: "Organisms",
    component: ProjectsView,
    defaultProps: {
      x: 69,
      y: 236,
      activeTab: "projects",
    },
    propTypes: [
      {
        name: "activeTab",
        type: "string",
        defaultValue: "projects",
        description: "Active tab: projects, branches, or pullRequests",
      },
      {
        name: "x",
        type: "number",
        defaultValue: 69,
        description: "Horizontal position",
      },
      {
        name: "y",
        type: "number",
        defaultValue: 236,
        description: "Vertical position",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(200, 250, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "projects-screen",
    title: "Projects Screen",
    description: "Complete projects screen layout combining the 'What should we build?' prompt and the projects grid with multiple project cards. Full-featured projects dashboard view.",
    category: "Organisms",
    component: ProjectsScreen,
    defaultProps: {},
    propTypes: [
      {
        name: "width",
        type: "number",
        defaultValue: 1920,
        description: "Screen width",
      },
      {
        name: "height",
        type: "number",
        defaultValue: 1080,
        description: "Screen height",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960, 400, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "projects-layout",
    title: "Projects Layout",
    description: "Complete Builder.io projects interface with StandardSidebar navigation and ProjectsScreen content. Demonstrates full application layout with sidebar and main content area.",
    category: "Organisms",
    component: ProjectsLayout,
    defaultProps: {
      x: 0,
      y: 0,
    },
    propTypes: [
      {
        name: "width",
        type: "number",
        defaultValue: 1920,
        description: "Layout width",
      },
      {
        name: "height",
        type: "number",
        defaultValue: 1080,
        description: "Layout height",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960, 400, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SLACK UI COMPONENTS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "slack-search-input",
    title: "Slack Search Input",
    description: "Slack-style search bar with hover border glow effect. Interactive input field used in Slack's top header.",
    category: "Atoms",
    component: SlackSearchInput,
    defaultProps: {
      width: 660,
      hoverProgress: 0,
    },
    propTypes: [
      {
        name: "width",
        type: "number",
        defaultValue: 660,
        description: "Input width in pixels",
      },
      {
        name: "hoverProgress",
        type: "number",
        defaultValue: 0,
        description: "Hover animation progress (0-1)",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960, 540, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "slack-nav-item",
    title: "Slack Nav Item",
    description: "Navigation button for Slack's left sidebar. Shows icon, label, and active state with scale-on-hover animation.",
    category: "Atoms",
    component: SlackNavItem,
    defaultProps: {
      icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9373ffc5818d27d9209df837578bf8fcb54420c1",
      label: "Home",
      isActive: true,
      hoverProgress: 0,
    },
    propTypes: [
      {
        name: "icon",
        type: "string",
        defaultValue: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9373ffc5818d27d9209df837578bf8fcb54420c1",
        description: "Icon image URL",
      },
      {
        name: "label",
        type: "string",
        defaultValue: "Home",
        description: "Navigation label text",
      },
      {
        name: "isActive",
        type: "boolean",
        defaultValue: true,
        description: "Whether this nav item is active",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960, 540, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "slack-channel-item",
    title: "Slack Channel Item",
    description: "Channel list item for Slack's middle sidebar. Shows channel icon and name with subtle hover effect.",
    category: "Atoms",
    component: SlackChannelItem,
    defaultProps: {
      icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9347f54e1f68efe048dd55867511b18da39a18a4",
      name: "product-dev",
      isActive: false,
      hoverProgress: 0,
    },
    propTypes: [
      {
        name: "icon",
        type: "string",
        defaultValue: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9347f54e1f68efe048dd55867511b18da39a18a4",
        description: "Channel icon URL",
      },
      {
        name: "name",
        type: "string",
        defaultValue: "product-dev",
        description: "Channel name",
      },
      {
        name: "isActive",
        type: "boolean",
        defaultValue: false,
        description: "Whether channel is active",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960, 540, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "slack-dm-item",
    title: "Slack DM Item",
    description: "Direct message list item with user avatar and name. Used in Slack's middle sidebar DM section.",
    category: "Atoms",
    component: SlackDMItem,
    defaultProps: {
      avatar: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/151a7d6433e4c148d7b8654cde84721864e79b7f",
      name: "Amelia Gordon 🍎",
      isActive: false,
      hoverProgress: 0,
    },
    propTypes: [
      {
        name: "avatar",
        type: "string",
        defaultValue: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/151a7d6433e4c148d7b8654cde84721864e79b7f",
        description: "User avatar image URL",
      },
      {
        name: "name",
        type: "string",
        defaultValue: "Amelia Gordon 🍎",
        description: "User display name",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960, 540, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "slack-message-card",
    title: "Slack Message Card",
    description: "Complete message card with avatar, author, timestamp, content, reactions, and thread info. Main chat message component.",
    category: "Molecules",
    component: SlackMessageCard,
    defaultProps: {
      avatar: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/151a7d6433e4c148d7b8654cde84721864e79b7f",
      author: "Amelia Gordon 🍎",
      timestamp: "Feb. 11th at 10:24 AM",
      content: "Yesterday our dev team launched a new feature for users who needed to migrate their accounts from the old infrastructure. We are seeing massive performance improvements, up 23%. Thanks team! 🎉",
      reactions: [
        { emoji: "🎉", count: 2 },
        { emoji: "🔥", count: 3 },
      ],
      threadReplies: 4,
      threadPreview: "Last reply 5hr ago",
      hoverProgress: 0,
    },
    propTypes: [
      {
        name: "avatar",
        type: "string",
        defaultValue: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/151a7d6433e4c148d7b8654cde84721864e79b7f",
        description: "Author avatar URL",
      },
      {
        name: "author",
        type: "string",
        defaultValue: "Amelia Gordon 🍎",
        description: "Message author name",
      },
      {
        name: "timestamp",
        type: "string",
        defaultValue: "Feb. 11th at 10:24 AM",
        description: "Message timestamp",
      },
      {
        name: "content",
        type: "string",
        defaultValue: "Message content text",
        description: "Message text content",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960, 540, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "slack-top-header",
    title: "Slack Top Header",
    description: "Slack's top navigation bar with navigation icons, centered search bar, and action buttons.",
    category: "Molecules",
    component: SlackTopHeader,
    defaultProps: {
      width: 1920,
      searchHoverProgress: 0,
    },
    propTypes: [
      {
        name: "width",
        type: "number",
        defaultValue: 1920,
        description: "Header width in pixels",
      },
      {
        name: "searchHoverProgress",
        type: "number",
        defaultValue: 0,
        description: "Search bar hover progress (0-1)",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960, 27, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "slack-left-sidebar",
    title: "Slack Left Sidebar",
    description: "Slack's left navigation sidebar with app logo, nav items (Home, DMs, Activity), and user avatar.",
    category: "Organisms",
    component: SlackLeftSidebar,
    defaultProps: {
      height: 1080,
      activeNav: "home",
      navHoverStates: {},
    },
    propTypes: [
      {
        name: "height",
        type: "number",
        defaultValue: 1080,
        description: "Sidebar height in pixels",
      },
      {
        name: "activeNav",
        type: "string",
        defaultValue: "home",
        description: "Active navigation item ID",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(50, 200, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "slack-middle-sidebar",
    title: "Slack Middle Sidebar",
    description: "Slack's middle sidebar with workspace header, navigation links, channels, DMs, and apps sections.",
    category: "Organisms",
    component: SlackMiddleSidebar,
    defaultProps: {
      height: 1080,
      activeChannel: "product-dev",
      channelHoverStates: {},
      dmHoverStates: {},
    },
    propTypes: [
      {
        name: "height",
        type: "number",
        defaultValue: 1080,
        description: "Sidebar height in pixels",
      },
      {
        name: "activeChannel",
        type: "string",
        defaultValue: "product-dev",
        description: "Active channel ID",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(240, 300, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "slack-main-content",
    title: "Slack Main Content",
    description: "Slack's main message feed area with channel header, tabs (Messages/Pins/Files), message list, and input.",
    category: "Organisms",
    component: SlackMainContent,
    defaultProps: {
      width: 900,
      height: 1080,
      messageHoverStates: {},
    },
    propTypes: [
      {
        name: "width",
        type: "number",
        defaultValue: 900,
        description: "Content area width in pixels",
      },
      {
        name: "height",
        type: "number",
        defaultValue: 1080,
        description: "Content area height in pixels",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960, 400, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "slack-thread-panel",
    title: "Slack Thread Panel",
    description: "Slack's right thread panel showing conversation thread with messages, Builder.io bot response, and reply input.",
    category: "Organisms",
    component: SlackThreadPanel,
    defaultProps: {
      width: 535,
      height: 1080,
    },
    propTypes: [
      {
        name: "width",
        type: "number",
        defaultValue: 535,
        description: "Thread panel width in pixels",
      },
      {
        name: "height",
        type: "number",
        defaultValue: 1080,
        description: "Thread panel height in pixels",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(1700, 400, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "slack-ui",
    title: "Slack UI (Complete)",
    description: "Complete Slack interface layout combining all components: top header, left sidebar, middle sidebar, main content, and thread panel. Full Slack app recreation.",
    category: "Organisms",
    component: SlackUI,
    defaultProps: {
      width: 1920,
      height: 1080,
      searchHoverProgress: 0,
      navHoverStates: {},
      channelHoverStates: {},
      dmHoverStates: {},
      messageHoverStates: {},
    },
    propTypes: [
      {
        name: "width",
        type: "number",
        defaultValue: 1920,
        description: "UI width in pixels",
      },
      {
        name: "height",
        type: "number",
        defaultValue: 1080,
        description: "UI height in pixels",
      },
    ],
    tracks: [
      createCameraTrack(150),
      makePreviewCursorTrack(960, 540, { fadeOpacity: true }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
];
