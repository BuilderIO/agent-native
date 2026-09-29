interface FinalizationGuardOptions<T> {
  ensureBackupDurable: () => Promise<void>;
  attemptFinalize: () => Promise<T>;
  releaseGuard: () => Promise<void> | void;
}

export async function finalizeAfterDurableBackup<T>({
  ensureBackupDurable,
  attemptFinalize,
  releaseGuard,
}: FinalizationGuardOptions<T>): Promise<T> {
  try {
    await ensureBackupDurable();
    return await attemptFinalize();
  } finally {
    await releaseGuard();
  }
}
