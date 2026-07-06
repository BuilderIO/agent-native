// Public API for @agent-native/core/collab

// Storage
export {
  loadYDocState,
  saveYDocState,
  hasCollabState,
  deleteCollabState,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "./storage.js";

// YDoc manager
export {
  getDoc,
  applyUpdate,
  applyText,
  getText,
  getState,
  getIncUpdate,
  seedFromText,
  releaseDoc,
  searchAndReplace,
  applyJson,
  applyPatchOps,
  getJson,
  seedFromJson,
} from "./ydoc-manager.js";

// XmlFragment operations
export { searchAndReplaceInYXml, extractTextFromYXml } from "./xml-ops.js";

// Text-to-Yjs bridge
export { applyTextToYDoc, initYDocWithText } from "./text-to-yjs.js";

// Emitter
export {
  getCollabEmitter,
  emitCollabUpdate,
  type CollabEvent,
} from "./emitter.js";

// Route handlers
export {
  getCollabState,
  postCollabUpdate,
  postCollabText,
  postCollabSearchReplace,
} from "./routes.js";

// JSON-to-Yjs bridge (structured data)
export {
  seedYDocFromJson,
  yMapToJson,
  yArrayToJson,
  yDocToJson,
  applyJsonDiff,
  applyJsonPatch,
  initYDocWithJson,
  type PatchOp,
} from "./json-to-yjs.js";

// Structured data route handlers
export {
  postCollabJson,
  getCollabJson,
  postCollabPatch,
} from "./struct-routes.js";

// Agent identity
export {
  AGENT_CLIENT_ID,
  DEFAULT_AGENT_IDENTITY,
  type AgentIdentity,
} from "./agent-identity.js";

// Agent presence lifecycle
export {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
  agentTouchDocument,
  agentApplyEditsIncrementally,
  agentApplyPatchesIncrementally,
  AGENT_PRESENCE_LINGER_MS,
  type AgentLeaveOptions,
  type AgentTouchOptions,
} from "./agent-presence.js";

// Recent-edit attribution (lingering highlights)
export {
  appendRecentEdit,
  collectRecentEdits,
  publishRecentEdit,
  useRecentEdits,
  RECENT_EDITS_MAX,
  RECENT_EDIT_TTL_MS,
  type RecentEdit,
  type RecentEditDescriptor,
  type AttributedRecentEdit,
  type UseRecentEditsOptions,
} from "./recent-edits.js";

// Per-user undo/redo
export {
  useCollabUndo,
  useLocalOpUndo,
  createLocalOpUndoController,
  type UseCollabUndoOptions,
  type UseCollabUndoResult,
  type CollabUndoScope,
  type UseLocalOpUndoOptions,
  type UseLocalOpUndoResult,
  type LocalOpUndoEntry,
  type LocalOpUndoController,
  type CreateLocalOpUndoOptions,
  type UndoKeyboardOptions,
} from "./undo.js";

// Awareness (re-export for agent-presence consumers)
export {
  getDocAwareness,
  getAwarenessEmitter,
  emitAwarenessChange,
  AWARENESS_CHANGE_EVENT,
  type AwarenessEntry,
  type AwarenessChangeEvent,
} from "./awareness.js";

// Presence kit
export {
  usePresence,
  toNormalized,
  fromNormalized,
  type OtherPresence,
  type PresencePayload,
  type UsePresenceResult,
  type NormalizedPoint,
} from "./presence.js";

// Follow mode
export {
  useFollowUser,
  type UseFollowUserOptions,
  type UseFollowUserResult,
  type ViewportDescriptor,
} from "./follow-mode.js";
