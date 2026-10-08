export { initializeAgentNativeClient } from "../client-bootstrap.js";
export {
  agentNativeApiDisabledReason,
  AgentNativeApiDisabledError,
  setAgentNativeApiDisabled,
} from "../api-surface.js";
export {
  ensureEmbedAuthFetchInterceptor,
  getEmbedAuthToken,
  isEmbedAuthActive,
  isEmbedMcpChatBridgeActive,
} from "../embed-auth.js";
export {
  sendToFrame,
  onFrameMessage,
  requestUserInfo,
  getFrameOrigin,
  getFramePostMessageTargetOrigin,
  getCallbackOrigin,
  oauthRedirectUri,
  isInFrame,
  isTrustedFrameMessage,
  enterStyleEditing,
  enterTextEditing,
  exitSelectionMode,
  type UserInfo,
} from "../frame.js";
export {
  getBuilderParentOrigin,
  isInBuilderFrame,
  sendToBuilderChat,
  shouldParentFrameOwnAgentPanel,
  isTrustedBuilderMessage,
  tryDelegateBuildRequestToBuilder,
  type BuilderChatMessage,
} from "../builder-frame.js";
export { getClientSurface, type ClientSurface } from "../client-surface.js";
export {
  defineClientAction,
  type AgentNativeClientActionDefinition,
  type AgentNativeClientActionRunner,
} from "../client-action.js";
export {
  DESKTOP_LOCAL_CODE_CHANGE_EVENT,
  requestDesktopLocalCodeChange,
  type DesktopLocalCodeChangeDetail,
} from "../desktop-local-code-change.js";
export {
  buildSessionReplayIframeBootstrap,
  injectSessionReplayIframeBootstrap,
} from "../../extensions/session-replay-iframe.js";
export {
  SESSION_REPLAY_IFRAME_ATTRIBUTE,
  SESSION_REPLAY_IFRAME_PROBE,
  SESSION_REPLAY_IFRAME_START,
  SESSION_REPLAY_IFRAME_STOP,
} from "../../session-replay-iframe-protocol.js";
export {
  AGENT_NATIVE_HOST_BRIDGE_VERSION,
  AGENT_NATIVE_HOST_MESSAGE_TYPES,
  announceAgentNativeFrameReady,
  createAgentNativeHostBridge,
  defaultAgentNativeHostCommands,
  onAgentNativeHostInit,
  readAgentNativeScreenContext,
  requestAgentNativeHostActions,
  requestAgentNativeHostContext,
  requestAgentNativeHostWebMcpTools,
  runAgentNativeHostAction,
  runAgentNativeHostWebMcpTool,
  sendAgentNativeHostCommand,
  type AgentNativeActionAvailability,
  type AgentNativeActionManifestEntry,
  type AgentNativeClientAction,
  type AgentNativeClientActionApprovalConfig,
  type AgentNativeClientActionGetter,
  type AgentNativeClientActionRuntime,
  type AgentNativeClientActions,
  type AgentNativeHostAuth,
  type AgentNativeHostAuthPayload,
  type AgentNativeHostBridge,
  type AgentNativeHostBridgeEvent,
  type AgentNativeHostBridgeOptions,
  type AgentNativeHostCapabilities,
  type AgentNativeHostCommandHandler,
  type AgentNativeHostCommandHandlers,
  type AgentNativeHostCommandRequest,
  type AgentNativeHostContext,
  type AgentNativeHostContextGetter,
  type AgentNativeHostInit,
  type AgentNativeHostMessageType,
  type AgentNativeHostRequestOptions,
  type AgentNativeHostResourceContext,
  type AgentNativeHostRouteContext,
  type AgentNativeHostSelectionContext,
  type AgentNativeHostSession,
  type AgentNativeJsonSchema,
  type AgentNativeScreenSnapshot,
  type AgentNativeScreenSnapshotOptions,
  type BuiltInAgentNativeHostCommand,
} from "../host-bridge.js";
export {
  AgentNativeWebMcpUnsupportedError,
  createAgentNativeWebMcpClient,
  createAgentNativeWebMcpRegistration,
  initializeAgentNativeWebMcp,
  isAgentNativeWebMcpSupported,
  type AgentNativeWebMcpApprovalRequest,
  type AgentNativeWebMcpClient,
  type AgentNativeWebMcpClientOptions,
  type AgentNativeWebMcpRegistration,
  type AgentNativeWebMcpRegistrationOptions,
  type AgentNativeWebMcpTool,
  type AgentNativeWebMcpToolAnnotations,
  type AgentNativeWebMcpToolExecutionOptions,
  type AgentNativeWebMcpToolResult,
} from "../webmcp.js";
export {
  AGENT_NATIVE_HOST_TOOL_NAMES,
  createAgentNativeHostTools,
  type AgentNativeHostToolDefinition,
  type AgentNativeHostToolName,
  type AgentNativeHostToolParameters,
  type AgentNativeHostToolSet,
  type CreateAgentNativeHostToolsOptions,
  type RunAgentNativeHostActionToolInput,
  type RunAgentNativeHostWebMcpToolInput,
  type SendAgentNativeHostCommandToolInput,
} from "../host-tools.js";
export {
  createAgentNativeBrowserSessionBridge,
  startAgentNativeBrowserSessionBridge,
  type AgentNativeBrowserSessionBridge,
  type AgentNativeBrowserSessionBridgeOptions,
} from "../browser-session-bridge.js";
export type {
  AgentNativeBrowserSession,
  AgentNativeBrowserSessionAction,
  AgentNativeBrowserSessionRecord,
  AgentNativeBrowserSessionRequest,
  AgentNativeBrowserSessionRequestStatus,
  AgentNativeBrowserSessionRequestType,
  CreateAgentNativeBrowserSessionRequestInput,
  RegisterAgentNativeBrowserSessionInput,
} from "../../browser-sessions/types.js";
export type {
  AppToFrameMessage,
  FrameToAppMessage,
  FrameMessage,
  CodeCompleteMessage,
  ChatRunningMessage,
} from "../frame-protocol.js";
