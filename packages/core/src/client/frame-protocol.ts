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
  type: "builder.appReady";
}

export interface SubmitChatMessage {
  type: "builder.submitChat";
  data: AgentChatMessage;
}

export interface GetUserInfoMessage {
  type: "builder.getUserInfo";
}

export interface SetEnvVarsMessage {
  type: "builder.setEnvVars";
  data: { vars: Array<{ key: string; value: string }> };
}

export type AppToFrameMessage =
  | AppReadyMessage
  | SubmitChatMessage
  | GetUserInfoMessage
  | SetEnvVarsMessage;

// ---------------------------------------------------------------------------
// Messages FROM frame TO app
// ---------------------------------------------------------------------------

export interface FrameOriginMessage {
  type: "builder.harnessOrigin";
  origin: string;
}

export interface ChatRunningMessage {
  type: "builder.chatRunning";
  detail: { isRunning: boolean; tabId?: string };
}

export interface UserInfoMessage {
  type: "builder.userInfo";
  data: { name?: string; email?: string };
}

export interface CodeCompleteMessage {
  type: "builder.codeComplete";
  tabId: string;
  success: boolean;
}

export type FrameToAppMessage =
  | FrameOriginMessage
  | ChatRunningMessage
  | UserInfoMessage
  | CodeCompleteMessage;

// ---------------------------------------------------------------------------
// All message types
// ---------------------------------------------------------------------------

export type FrameMessage = AppToFrameMessage | FrameToAppMessage;

// ---------------------------------------------------------------------------
// Backward compatibility aliases
// ---------------------------------------------------------------------------

/** @deprecated Use `AppToFrameMessage` instead */
export type AppToHarnessMessage = AppToFrameMessage;

/** @deprecated Use `FrameToAppMessage` instead */
export type HarnessToAppMessage = FrameToAppMessage;

/** @deprecated Use `FrameOriginMessage` instead */
export type HarnessOriginMessage = FrameOriginMessage;

/** @deprecated Use `FrameMessage` instead */
export type HarnessMessage = FrameMessage;
