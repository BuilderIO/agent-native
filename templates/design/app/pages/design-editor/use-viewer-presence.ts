import {
  useCollaborativeDoc,
  type CollabUser,
} from "@agent-native/core/client/collab";

/**
 * A viewer joins the document an editor would, without ever receiving its
 * `ydoc`: content still reaches it through `get-design`. Joining is what lets
 * the collab client see an editor on the document and poll every few seconds;
 * without it a viewer on a serverless host only hears about edits at the 1-5
 * minute idle cadence.
 */
export function viewerPresenceDocId(input: {
  isSignedIn: boolean;
  canEditDesign: boolean;
  accessRole: string | undefined;
  fileId: string | null;
}): string | null {
  if (!input.isSignedIn || input.canEditDesign) return null;
  return input.accessRole === "viewer" ? input.fileId : null;
}

export function useViewerPresence(input: {
  isSignedIn: boolean;
  canEditDesign: boolean;
  accessRole: string | undefined;
  fileId: string | null;
  requestSource: string;
  user: CollabUser | undefined;
}): void {
  useCollaborativeDoc({
    docId: viewerPresenceDocId(input),
    requestSource: input.requestSource,
    user: input.user,
  });
}
