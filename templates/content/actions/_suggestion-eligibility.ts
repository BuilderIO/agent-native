export const INLINE_DATABASE_SUGGESTION_EXCLUSION = "<InlineDatabase";

export function documentHasInlineDatabase(content: string) {
  return content.includes(INLINE_DATABASE_SUGGESTION_EXCLUSION);
}

export function canSuggestDocument(args: {
  canComment: boolean;
  isDatabase: boolean;
  isOrdinaryDatabaseItem: boolean;
  isExternallyLinked: boolean;
  isSourceOwned: boolean;
  hasInlineDatabase: boolean;
}) {
  return (
    args.canComment &&
    !args.isDatabase &&
    !args.isOrdinaryDatabaseItem &&
    !args.isExternallyLinked &&
    !args.isSourceOwned &&
    !args.hasInlineDatabase
  );
}
