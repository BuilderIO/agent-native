export function shouldInvalidateMailQueryForActionEvent(query: {
  queryKey: readonly unknown[];
}): boolean {
  return query.queryKey[0] === "action";
}
