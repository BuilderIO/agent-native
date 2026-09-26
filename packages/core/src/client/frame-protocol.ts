
import type {
  AgentChatContextMutationOptions,
  AgentChatContextRemoveOptions,
  AgentChatContextSetOptions,
  AgentChatMessage,
} from "./agent-chat.js";


export interface AppReadyMessage {
  type: "agentNative.appReady";
}

export interface SubmitChatMessage {
  type: "agentNative.submitChat";
  data: AgentChatMessage;
}

export interface SetChatContextMessage {
  type: "agentNative.setChatContext";
  data: AgentChatContextSetOptions;
}

export interface RemoveChatContextMessage {
  type: "agentNative.removeChatContext";
  data: AgentChatContextRemoveOptions;
}

export interface ClearChatContextMessage {
  type: "agentNative.clearChatContext";
  data: AgentChatContextMutationOptions;
}

export interface GetUserInfoMessage {
  type: "agentNative.getUserInfo";
}

export interface SetEnvVarsMessage {
  type: "agentNative.setEnvVars";
  data: { vars: Array<{ key: string; value: string }> };
}

export interface DevModeChangeMessage {
  type: "agentNative.devModeChange";
  data: { isDevMode: boolean };
}

export interface ToggleSidebarMessage {
  type: "agentNative.toggleSidebar";
  data?: { open?: boolean; focus?: boolean };
}

export interface PerAppChatSidebarStateMessage {
  type: "agentNative.perAppChatState";
  data: { open: boolean; hosted: boolean };
}

export interface PerAppChatSidebarStateRequestMessage {
  type: "agentNative.perAppChatStateRequest";
}

export interface EnterStyleEditingMessage {
  type: "agentNative.enterStyleEditing";
  data: { selector: string };
}

export interface EnterTextEditingMessage {
  type: "agentNative.enterTextEditing";
  data: { selector: string };
}

export interface ExitSelectionModeMessage {
  type: "agentNative.exitSelectionMode";
}

export interface PresentationModeMessage {
  type: "agentNative.presentationMode";
  data: { active: boolean };
}

export interface DesignCloseMessage {
  type: "design:close";
}

export type AppToFrameMessage =
  | AppReadyMessage
  | AuthStateMessage
  | SubmitChatMessage
  | SetChatContextMessage
  | RemoveChatContextMessage
  | ClearChatContextMessage
  | GetUserInfoMessage
  | SetEnvVarsMessage
  | DevModeChangeMessage
  | ToggleSidebarMessage
  | PerAppChatSidebarStateRequestMessage
  | EnterStyleEditingMessage
  | EnterTextEditingMessage
  | ExitSelectionModeMessage
  | PresentationModeMessage
  | DesignCloseMessage;


export interface FrameOriginMessage {
  type: "agentNative.frameOrigin";
  origin: string;
}

export interface ChatRunningMessage {
  type: "agentNative.chatRunning";
  detail: {
    isRunning: boolean;
    tabId?: string;
    reason?: "stopped" | "failed";
  };
}

export interface UserInfoMessage {
  type: "agentNative.userInfo";
  data: { name?: string; email?: string };
}

export interface AuthStateMessage {
  type: "agentNative.authState";
  data: { status: "authenticated" | "unauthenticated" };
}

export interface CodeCompleteMessage {
  type: "agentNative.codeComplete";
  tabId: string;
  success: boolean;
}

export interface SidebarModeMessage {
  type: "agentNative.sidebarMode";
  data: {
    mode: "code" | "app";
    appMode?: "cli" | "resources" | "chat";
    width?: number;
    open?: boolean;
    wide?: boolean;
    placeholderWidth?: number;
  };
}

export interface DesignInitMessage {
  type: "design:init";
  data: {
    previewUrl: string;
    themeVars?: Record<string, string>;
    context?: { projectId?: string; branchId?: string; orgId?: string };
  };
}

export type FrameToAppMessage =
  | FrameOriginMessage
  | ChatRunningMessage
  | UserInfoMessage
  | PerAppChatSidebarStateMessage
  | CodeCompleteMessage
  | SidebarModeMessage
  | PresentationModeMessage
  | DesignInitMessage;


export type FrameMessage = AppToFrameMessage | FrameToAppMessage;
