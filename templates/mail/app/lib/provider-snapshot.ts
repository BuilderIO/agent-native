type ProviderSnapshotGlobals = {
  __mailProviderSnapshotId?: number;
};

const globals = globalThis as ProviderSnapshotGlobals;

export function beginProviderSnapshot(): number {
  const nextId = (globals.__mailProviderSnapshotId ?? 0) + 1;
  globals.__mailProviderSnapshotId = nextId;
  return nextId;
}

export function currentProviderSnapshotId(): number {
  return globals.__mailProviderSnapshotId ?? 0;
}
