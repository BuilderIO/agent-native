export function suggestedEditorIsolation(args: {
  suggesting: boolean;
  canSuggest: boolean;
  canEdit: boolean;
  collaborationReady: boolean;
}) {
  // While suggesting, the editor holds the draft, so reconciling it against the
  // canonical revision would hand the draft to the canonical save path, and
  // following the canonical timestamp would re-apply the draft over unsent text.
  return args.suggesting
    ? {
        editable: args.canSuggest,
        bindCanonicalYDoc: false,
        persistCanonical: false,
        reconcileCanonical: false,
      }
    : {
        editable: args.canEdit,
        bindCanonicalYDoc: args.collaborationReady,
        persistCanonical: args.canEdit,
        reconcileCanonical: true,
      };
}
