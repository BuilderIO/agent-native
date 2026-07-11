type SyncEvent = {
  source?: string;
  key?: string;
};

type Listener = () => void;

const listeners = new Set<Listener>();

export function isProviderCorpusJobSyncEvent(event: SyncEvent): boolean {
  return (
    (event.source === "action" && event.key === "provider-corpus-job") ||
    event.source === "provider-corpus-jobs"
  );
}

/** Forward the root's shared DB-sync event without opening another transport. */
export function notifyProviderCorpusJobSyncEvent(event: SyncEvent): void {
  if (!isProviderCorpusJobSyncEvent(event)) return;
  for (const listener of listeners) listener();
}

export function subscribeProviderCorpusJobSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
