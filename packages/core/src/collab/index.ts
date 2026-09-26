
export {
  loadYDocState,
  saveYDocState,
  hasCollabState,
  deleteCollabState,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "./storage.js";

export {
  CollabBaseVersionConflictError,
  getDoc,
  withPreparedYDocMutation,
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
  type PreparedYDocMutationLease,
} from "./ydoc-manager.js";

export { searchAndReplaceInYXml, extractTextFromYXml } from "./xml-ops.js";

export { applyTextToYDoc, initYDocWithText } from "./text-to-yjs.js";

export {
  getCollabEmitter,
  emitCollabUpdate,
  type CollabEvent,
} from "./emitter.js";

export {
  getCollabState,
  postCollabUpdate,
  postCollabText,
  postCollabSearchReplace,
} from "./routes.js";

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

export {
  postCollabJson,
  getCollabJson,
  postCollabPatch,
} from "./struct-routes.js";

export {
  AGENT_CLIENT_ID,
  DEFAULT_AGENT_IDENTITY,
  type AgentIdentity,
} from "./agent-identity.js";

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

export {
  getDocAwareness,
  getAwarenessEmitter,
  emitAwarenessChange,
  AWARENESS_CHANGE_EVENT,
  type AwarenessEntry,
  type AwarenessChangeEvent,
} from "./awareness.js";
export {
  loadAwarenessRows,
  loadAwarenessRowsStrict,
} from "./awareness-store.js";

export {
  usePresence,
  toNormalized,
  fromNormalized,
  type OtherPresence,
  type PresencePayload,
  type UsePresenceResult,
  type NormalizedPoint,
} from "./presence.js";

export {
  useFollowUser,
  type UseFollowUserOptions,
  type UseFollowUserResult,
  type ViewportDescriptor,
} from "./follow-mode.js";
