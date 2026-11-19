const WRITER_LOCK_PREFIX = "agent-native-design-save-writer:";

function lockManager(): LockManager | null {
  if (typeof navigator === "undefined") return null;
  // Typed as always present, but absent outside secure contexts.
  return (navigator as { locks?: LockManager }).locks ?? null;
}

/**
 * Holds a Web Lock named for this editor's save session until the returned
 * release runs. Every tab shares the outbox, so the lock is how another tab
 * tells a copy whose editor is still open and sending it from one a closed tab
 * left behind; the browser drops it with the tab.
 */
export function holdDesignSaveWriter(operationSource: string): () => void {
  const locks = lockManager();
  if (!locks) return () => {};
  let released = false;
  let release: (() => void) | null = null;
  locks
    .request(
      WRITER_LOCK_PREFIX + operationSource,
      () =>
        new Promise<void>((resolve) => {
          if (released) resolve();
          else release = resolve;
        }),
    )
    .catch((error: unknown) => {
      // coercion-ok: A writer whose lock was refused reads as gone, so another
      // tab may replay its copies, as it did before writer locks. Reading it as
      // live instead would strand its copies once this tab closed.
      console.warn(
        "Could not hold the design save writer lock; another tab may replay this editor's saves",
        error,
      );
    });
  return () => {
    released = true;
    release?.();
  };
}

/**
 * Resolves once no editor holds this save session's lock, at once if none does,
 * so a tab that skipped the session's copies can take them when it closes. The
 * lock queue itself says when: nothing is polled. Rejects with an AbortError if
 * `signal` aborts first, and returns null when the browser has no Web Locks.
 */
export function waitForDesignSaveWriterRelease(
  operationSource: string,
  signal: AbortSignal,
): Promise<void> | null {
  const locks = lockManager();
  if (!locks) return null;
  return locks.request(
    WRITER_LOCK_PREFIX + operationSource,
    { signal },
    async () => {},
  );
}

/**
 * The save sessions whose editors are open in some tab, or null when this
 * browser has no Web Locks, or will not list them, and cannot tell.
 */
export async function liveDesignSaveWriterSources(): Promise<ReadonlySet<string> | null> {
  const locks = lockManager();
  if (!locks) return null;
  try {
    const { held = [] } = await locks.query();
    return new Set(
      held.flatMap(({ name }) =>
        name?.startsWith(WRITER_LOCK_PREFIX)
          ? [name.slice(WRITER_LOCK_PREFIX.length)]
          : [],
      ),
    );
    // coercion-ok: null means "cannot tell", which replays every copy as before writer locks.
  } catch (error) {
    console.warn("Could not list the open design save writers", error);
    return null;
  }
}
