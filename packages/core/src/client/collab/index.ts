export {
  useCollaborativeDoc,
  isReconcileLeadClient,
  emailToColor,
  emailToName,
  dedupeCollabUsersByEmail,
  type CollabUser,
  type UseCollaborativeDocOptions,
  type UseCollaborativeDocResult,
} from "../../collab/client.js";
export { AGENT_CLIENT_ID } from "../../collab/agent-identity.js";
export {
  usePresence,
  toNormalized,
  fromNormalized,
  type OtherPresence,
  type PresencePayload,
  type UsePresenceResult,
  type NormalizedPoint,
} from "../../collab/presence.js";
export {
  useFollowUser,
  type UseFollowUserOptions,
  type UseFollowUserResult,
  type ViewportDescriptor,
} from "../../collab/follow-mode.js";
export {
  useCollaborativeMap,
  useCollaborativeArray,
  type UseCollaborativeMapOptions,
  type UseCollaborativeMapResult,
  type UseCollaborativeArrayOptions,
  type UseCollaborativeArrayResult,
} from "../../collab/client-struct.js";
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
} from "../../collab/recent-edits.js";
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
} from "../../collab/undo.js";
