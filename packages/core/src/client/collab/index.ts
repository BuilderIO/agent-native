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
  PresenceBar,
  type PresenceBarProps,
} from "../components/PresenceBar.js";
export {
  AgentPresenceChip,
  type AgentPresenceChipProps,
} from "../components/AgentPresenceChip.js";
export {
  LiveCursorOverlay,
  type LiveCursorOverlayProps,
  type CursorMapFn,
} from "../components/LiveCursorOverlay.js";
export {
  RemoteSelectionRings,
  type RemoteSelectionRingsProps,
} from "../components/RemoteSelectionRings.js";
