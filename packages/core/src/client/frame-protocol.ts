/**
 * Frame Protocol — typed message definitions for frame communication.
 *
 * Any frame implementation (local dev frame, Builder.io cloud, Electron)
 * must support these message types. Communication happens via postMessage
 * between the app iframe and the parent frame.
 */

import type { AgentChatMessage } from "./agent-chat.js";

// ---------------------------------------------------------------------------
// Messages FROM app TO frame
// ---------------------------------------------------------------------------

export interface AppReadyMessage {
  type: "agentNative.appReady";
}

export interface SubmitChatMessage {
  type: "agentNative.submitChat";
  data: AgentChatMessage;
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
  data?: { open?: boolean };
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

/**
 * Sent both ways: the app announces it has entered/exited presentation mode
 * (so the frame can hide its chrome), and an outer frame can push the app
 * into presentation mode (so the app's sidebar hides).
 */
export interface PresentationModeMessage {
  type: "agentNative.presentationMode";
  data: { active: boolean };
}

export type AppToFrameMessage =
  | AppReadyMessage
  | SubmitChatMessage
  | GetUserInfoMessage
  | SetEnvVarsMessage
  | DevModeChangeMessage
  | ToggleSidebarMessage
  | EnterStyleEditingMessage
  | EnterTextEditingMessage
  | ExitSelectionModeMessage
  | PresentationModeMessage;

// ---------------------------------------------------------------------------
// Messages FROM frame TO app
// ---------------------------------------------------------------------------

export interface FrameOriginMessage {
  type: "agentNative.frameOrigin";
  origin: string;
}

export interface ChatRunningMessage {
  type: "agentNative.chatRunning";
  detail: { isRunning: boolean; tabId?: string };
}

export interface UserInfoMessage {
  type: "agentNative.userInfo";
  data: { name?: string; email?: string };
}

export interface CodeCompleteMessage {
  type: "agentNative.codeComplete";
  tabId: string;
  success: boolean;
}

export interface SidebarModeMessage {
  type: "agentNative.sidebarMode";
  data: {
    /** "code" hides the app's sidebar (frame controls it); "app" defers to the app. */
    mode: "code" | "app";
    /** When mode === "app", which panel the app should show. */
    appMode?: "cli" | "resources" | "chat";
    /** Frame-controlled sidebar width to sync into the app. */
    width?: number;
    /** Whether the app's sidebar should be open. */
    open?: boolean;
  };
}

export type FrameToAppMessage =
  | FrameOriginMessage
  | ChatRunningMessage
  | UserInfoMessage
  | CodeCompleteMessage
  | SidebarModeMessage
  | PresentationModeMessage;

// ---------------------------------------------------------------------------
// All message types
// ---------------------------------------------------------------------------

export type FrameMessage = AppToFrameMessage | FrameToAppMessage;
