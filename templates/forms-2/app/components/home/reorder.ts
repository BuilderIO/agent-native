/** Moves `id` to index `to`, clamped to the list. Returns the same array when nothing changes. */
export function moveItem(ids: string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const target = Math.min(Math.max(to, 0), ids.length - 1);
  if (target === from) return ids;
  const next = ids.filter((item) => item !== id);
  next.splice(target, 0, id);
  return next;
}

export function shiftItem(ids: string[], id: string, delta: -1 | 1): string[] {
  return moveItem(ids, id, ids.indexOf(id) + delta);
}
