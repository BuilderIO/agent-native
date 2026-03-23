/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LIBRARY COMPONENTS - Barrel Export
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Export all reusable UI components from the library.
 * These components can be imported into Studio compositions.
 *
 * Usage in compositions:
 *   import { Card } from "@/remotion/library-components";
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Organisms
export { Card, type CardProps } from "./Card";
export { CodePanel, type CodePanelProps } from "./CodePanel";
export { StandardSidebar, type StandardSidebarProps } from "./StandardSidebar";
export { ProjectsSidebar, type ProjectsSidebarProps } from "./ProjectsSidebar";
export { ProjectsScreen, type ProjectsScreenProps } from "./ProjectsScreen";
export { ProjectsLayout, type ProjectsLayoutProps } from "./ProjectsLayout";
export { BranchesScreen, type BranchesScreenProps } from "./BranchesScreen";
export { BranchesLayout, type BranchesLayoutProps } from "./BranchesLayout";
export { StandardView, type StandardViewProps } from "./StandardView";
export {
  CreateProjectPrompt,
  type CreateProjectPromptProps,
} from "./CreateProjectPrompt";
export { ProjectsView, type ProjectsViewProps } from "./ProjectsView";
export {
  BranchesKanbanView,
  type BranchesKanbanViewProps,
} from "./BranchesKanbanView";
export {
  BranchesKanbanColumn,
  type KanbanColumnProps,
} from "./BranchesKanbanColumn";
export { AgentPanel, type AgentPanelProps } from "./AgentPanel";
export {
  AppPreviewHeader,
  type AppPreviewHeaderProps,
} from "./AppPreviewHeader";

// Molecules
export { ProjectCard, type ProjectCardProps } from "./ProjectCard";
export { BranchCard, type BranchCardProps } from "./BranchCard";

// Atoms
export {
  UserMessage,
  type UserMessageProps,
  AgentMessage,
  type AgentMessageProps,
} from "./ChatMessage";

// Atoms
export { Button, type ButtonProps } from "./Button";
export { SecondaryButton, type SecondaryButtonProps } from "./SecondaryButton";
export { PrimaryButton, type PrimaryButtonProps } from "./PrimaryButton";
export { SectionHeader, type SectionHeaderProps } from "./SectionHeader";
export { FileItem, type FileItemProps } from "./FileItem";
export { FolderItem, type FolderItemProps } from "./FolderItem";

// Slack Components (Interactive Wrappers)
export {
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
} from "./SlackComponents";
