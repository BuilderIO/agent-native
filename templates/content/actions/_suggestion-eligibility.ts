export const INLINE_DATABASE_SUGGESTION_EXCLUSION = "<InlineDatabase";

export function documentHasInlineDatabase(content: string) {
  return content.includes(INLINE_DATABASE_SUGGESTION_EXCLUSION);
}

export function hasSuggestionBodyTarget(args: {
  hasDatabaseMembership: boolean;
  hasPrimaryBlocksField: boolean;
}) {
  return !args.hasDatabaseMembership || args.hasPrimaryBlocksField;
}

export function canSuggestDocument(args: {
  canComment: boolean;
  isDatabase: boolean;
  hasBodyTarget: boolean;
  isExternallyLinked: boolean;
  isSourceOwned: boolean;
  hasInlineDatabase: boolean;
}) {
  return (
    args.canComment &&
    !args.isDatabase &&
    args.hasBodyTarget &&
    !args.isExternallyLinked &&
    !args.isSourceOwned &&
    !args.hasInlineDatabase
  );
}
