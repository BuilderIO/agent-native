type Write = { propertyId: string; promise: Promise<unknown> };
const pending = new Map<string, Set<Write>>();
const latest = new Map<string, Write>();
const failures = new Map<string, Map<string, unknown>>();

export function trackDocumentPropertyWrite<T>(
  documentId: string,
  propertyId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const writes = pending.get(documentId) ?? new Set<Write>();
  pending.set(documentId, writes);
  const write: Write = { propertyId, promise: Promise.resolve() };
  const key = JSON.stringify([documentId, propertyId]);
  latest.set(key, write);
  const promise = Promise.resolve()
    .then(operation)
    .then(
      (result) => {
        if (latest.get(key) !== write) return result;
        failures.get(documentId)?.delete(propertyId);
        if (failures.get(documentId)?.size === 0) failures.delete(documentId);
        return result;
      },
      (error: unknown) => {
        if (latest.get(key) !== write) throw error;
        const errors = failures.get(documentId) ?? new Map<string, unknown>();
        errors.set(propertyId, error);
        failures.set(documentId, errors);
        throw error;
      },
    )
    .finally(() => {
      if (latest.get(key) === write) latest.delete(key);
      writes.delete(write);
      if (writes.size === 0) pending.delete(documentId);
    });
  write.promise = promise;
  writes.add(write);
  return promise;
}

export async function flushDocumentPropertyWrites(
  documentId: string,
): Promise<void> {
  while (pending.get(documentId)?.size) {
    await Promise.allSettled(
      [...pending.get(documentId)!].map((write) => write.promise),
    );
  }
  const errors = failures.get(documentId);
  if (errors?.size) throw errors.values().next().value;
}
