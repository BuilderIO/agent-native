export function suggestedEditorIsolation(args: {
  suggesting: boolean;
  canSuggest: boolean;
  canEdit: boolean;
  collaborationReady: boolean;
  canonicalUpdatedAt: string;
  draftUpdatedAt: string;
}) {
  // While suggesting, the editor holds the draft, so reconciling it against the
  // canonical revision would hand the draft to the canonical save path. The
  // editor re-adopts its content, and a read-only one remounts, whenever this
  // timestamp moves, so following the canonical one would replace text the
  // editor has not handed to the draft yet.
  return args.suggesting
    ? {
        editable: args.canSuggest,
        bindCanonicalYDoc: false,
        persistCanonical: false,
        reconcileCanonical: false,
        contentUpdatedAt: args.draftUpdatedAt,
      }
    : {
        editable: args.canEdit,
        bindCanonicalYDoc: args.collaborationReady,
        persistCanonical: args.canEdit,
        reconcileCanonical: true,
        contentUpdatedAt: args.canonicalUpdatedAt,
      };
}
