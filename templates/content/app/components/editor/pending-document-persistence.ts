export function trackPendingDocumentPersistence<T>(
  pending: Set<Promise<unknown>>,
  request: Promise<T>,
  onResolved: (result: T) => void,
  onRejected: (error: unknown) => void,
): void {
  const settled = request.then(onResolved, onRejected);
  const tracked = settled.finally(() => pending.delete(tracked));
  pending.add(tracked);
}
