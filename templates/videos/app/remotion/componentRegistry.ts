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
  Card,
  type CardProps,
  Button,
  type ButtonProps,
  CodePanel,
  type CodePanelProps,
  SecondaryButton,
  type SecondaryButtonProps,
  PrimaryButton,
  type PrimaryButtonProps,
  SectionHeader,
  type SectionHeaderProps,
  FileItem,
  type FileItemProps,
  FolderItem,
  type FolderItemProps,
} from "./library-components";
import { createCameraTrack, createCursorTrack } from "./trackHelpers";

/**
 * Standard 5-second component preview cursor track (150 frames @ 30fps).
 * Timeline: arrive at 0.5s, hover, click at 2s, exit at 3.5s
 */
function makePreviewCursorTrack(
  cx: number,
  cy: number,
  opts: { clickFrame?: number; fadeOpacity?: boolean } = {},
): AnimationTrack {
  const { clickFrame = 60, fadeOpacity = false } = opts;
  const track = createCursorTrack(150, { startX: 200, startY: 200 });

  track.animatedProps.find((p) => p.property === "x")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: String(cx) }, // Arrive at 0.5s
    { frame: 90, value: String(cx) }, // Stay
    { frame: 120, value: "1720" },
    { frame: 150, value: "1720" },
  ];
  track.animatedProps.find((p) => p.property === "y")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: String(cy) },
    { frame: 90, value: String(cy) },
    { frame: 120, value: "200" },
    { frame: 150, value: "200" },
  ];
  track.animatedProps.find((p) => p.property === "isClicking")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: clickFrame - 1, value: "0" },
    { frame: clickFrame, value: "1" },
    { frame: clickFrame + 10, value: "0" },
    { frame: 150, value: "0" },
  ];
  if (fadeOpacity) {
    track.animatedProps.find((p) => p.property === "opacity")!.keyframes = [
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
    description:
      "A simple interactive card component with text content. Demonstrates hover and click animations.",
    category: "Organisms",
    component: Card,
    defaultProps: {
      title: "Interactive Card",
      description:
        "Hover over me to see the scale animation. Click to see the press effect!",
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
        defaultValue:
          "This is a card component with hover and click animations.",
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
    description:
      "An interactive button component. Demonstrates hover and click animations with scale and brightness effects.",
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
      makePreviewCursorTrack(1920 / 2 - 16, 1080 / 2 - 16, {
        fadeOpacity: true,
      }),
    ],
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: "secondary-button",
    title: "Secondary Button",
    description:
      "An outline-style button with optional icon. Used for secondary actions like Share or Cancel buttons.",
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
    description:
      "A solid background button with optional icon. Used for primary CTAs like Send PR or Push to Remote.",
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
        defaultValue:
          "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/81e7eb620e52aae529258200f6dff2cc38027cd8?placeholderIfAbsent=true",
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
    description:
      "A section header with icon and uppercase text. Used for consistent labeling like ALL CHANGES, ALL FILES, etc.",
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
        defaultValue:
          "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f872b16106ef6bbaea80fcefece2392325659d2c?placeholderIfAbsent=true",
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
    description:
      "A file list item with icon, name, line count badge, and file path. Demonstrates hover brightness effect.",
    category: "Atoms",
    component: FileItem,
    defaultProps: {
      icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/10ff8b681a169f3c2b0c90b4fd672a0e7173771b?placeholderIfAbsent=true",
      name: "MyComponent.tsx",
      lineCount: "+ 42",
      path: "client/remotion/compositions",
      x: 760,
      y: 528,
    },
    propTypes: [
      {
        name: "icon",
        type: "string",
        defaultValue:
          "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/10ff8b681a169f3c2b0c90b4fd672a0e7173771b?placeholderIfAbsent=true",
        description: "File type icon image URL",
      },
      {
        name: "name",
        type: "string",
        defaultValue: "MyComponent.tsx",
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
    description:
      "A collapsible folder item with chevron and folder icon. Used in file explorer trees.",
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
    description:
      "A complete code explorer panel showing file changes and project structure. Demonstrates atomic design composition with interactive file items, folders, and action buttons.",
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
];
