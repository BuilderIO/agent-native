export function suggestedEditorIsolation(args: {
  suggesting: boolean;
  canSuggest: boolean;
  canEdit: boolean;
  collaborationReady: boolean;
}) {
  return args.suggesting
    ? {
        editable: args.canSuggest,
        bindCanonicalYDoc: false,
        persistCanonical: false,
      }
    : {
        editable: args.canEdit,
        bindCanonicalYDoc: args.collaborationReady,
        persistCanonical: args.canEdit,
      };
}
