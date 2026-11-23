import type { ReactNode } from "react";

import type { CapabilityDecision } from "../../../shared/capabilities";

export type WorkspaceShellWorkspace = {
  id: string;
  name: string;
};

export type WorkspaceShellUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
};

export type WorkspaceShellFeatures = {
  contextStudio: boolean;
  isManagerOrAbove: boolean;
  threads: boolean;
  tasks: boolean;
  library?: boolean;
  folders: boolean;
  developerTools: boolean;
  canCreateProject: boolean;
  canCreateThread: boolean;
};

export type WorkspaceShellRowKind =
  | "project"
  | "thread"
  | "collection"
  | "data";

export type WorkspaceShellRow = {
  id: string;
  title: string;
  kind: WorkspaceShellRowKind;
  href: string;
};

export type WorkspaceShellHandler = () => void | Promise<void>;

export type WorkspaceShellWorkspaceEntry = {
  id: string;
  name: string;
  memberCount?: number;
  role?: string;
  needsLogin?: boolean;
  ssoEnforced?: boolean;
};

export type WorkspaceShellWorkspaceMenu = {
  workspaces?: readonly WorkspaceShellWorkspaceEntry[];
  isPlatformAdmin?: boolean;
  canAddWorkspace?: boolean;
  onSwitchWorkspace?: (workspaceId: string) => void | Promise<void>;
  onLoginToWorkspace?: (workspaceId: string) => void | Promise<void>;
  onAddWorkspace?: WorkspaceShellHandler;
  onLogout?: WorkspaceShellHandler;
  onLogoutAll?: WorkspaceShellHandler;
  onOpenPlatformAdmin?: WorkspaceShellHandler;
};

export type WorkspaceShellAccountMenu = {
  onCopyDebugInfo?: WorkspaceShellHandler;
};

export type WorkspaceShellQuickCreate = {
  onCreateComponent?: WorkspaceShellHandler;
  onCreateExploration?: WorkspaceShellHandler;
  onCreateCollection?: WorkspaceShellHandler;
  onCreateFolder?: WorkspaceShellHandler;
  onImportProject?: WorkspaceShellHandler;
  onImportComponent?: WorkspaceShellHandler;
};

export type WorkspaceShellNotification = {
  id: string;
  title: string;
  description?: string;
  createdAtLabel?: string;
  href?: string;
  read: boolean;
};

export type WorkspaceShellNotifications =
  | {
      status: "loading";
      unreadCount?: number;
    }
  | {
      status: "ready";
      items: readonly WorkspaceShellNotification[];
      unreadCount?: number;
      pending?: boolean;
      onMarkAllRead?: WorkspaceShellHandler;
      onOpenNotification?: (
        notification: WorkspaceShellNotification,
      ) => void | Promise<void>;
    }
  | {
      status: "error";
      errorMessage?: string;
      onRetry?: WorkspaceShellHandler;
    };

export interface WorkspaceShellProps {
  children: ReactNode;
  workspace: WorkspaceShellWorkspace;
  user: WorkspaceShellUser;
  features: WorkspaceShellFeatures;
  capabilities?: readonly CapabilityDecision[];
  recents: WorkspaceShellRow[];
  favorites: WorkspaceShellRow[];
  detailsStatus?: "loading" | "error" | "ready";
  onCreateProject: WorkspaceShellHandler;
  onCreateThread: WorkspaceShellHandler;
  onOpenSearch: WorkspaceShellHandler;
  workspaceMenu?: WorkspaceShellWorkspaceMenu;
  accountMenu?: WorkspaceShellAccountMenu;
  quickCreate?: WorkspaceShellQuickCreate;
  notifications?: WorkspaceShellNotifications;
}
