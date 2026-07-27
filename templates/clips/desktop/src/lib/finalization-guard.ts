interface FinalizationGuardOptions<T> {
  ensureBackupDurable: () => Promise<void>;
  attemptFinalize: () => Promise<T>;
  releaseGuard: () => Promise<void> | void;
}

/**
 * Keep the desktop's post-stop guard visible until recovery metadata is
 * durable and the finalize request has settled at least once.
 */
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
