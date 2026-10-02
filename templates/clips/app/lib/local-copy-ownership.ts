import { claimRecordingBackupLock } from "./recording-backup";

export type LocalCopyClaim = "held" | "busy" | "unavailable";

interface CopyLock {
  id: string;
  status: "pending" | "held" | "unavailable";
  claimed: Promise<LocalCopyClaim>;
  release: () => void;
  released: boolean;
}

function letGo(lock: CopyLock): void {
  lock.released = true;
  lock.release();
}

/**
 * The local copy this tab owns. "held": its Web Lock is granted.
 * "unavailable": the browser has no Web Locks, so only a copy this tab
 * recorded itself may be uploaded or deleted.
 */
export class LocalCopyOwnership {
  private lock: CopyLock | null = null;
  private readonly recordedHere = new Set<string>();

  get id(): string | null {
    return this.lock?.id ?? null;
  }

  markRecordedHere = (id: string): void => {
    this.recordedHere.add(id);
  };

  wasRecordedHere = (id: string): boolean => this.recordedHere.has(id);

  /** Concurrent calls for one copy share a single claim. */
  hold = (id: string): Promise<LocalCopyClaim> => {
    if (this.lock?.id === id) return this.lock.claimed;
    this.release();
    const lock: CopyLock = {
      id,
      status: "pending",
      claimed: Promise.resolve("busy"),
      release: () => {},
      released: false,
    };
    this.lock = lock;
    lock.claimed = claimRecordingBackupLock(id).then((claim) => {
      const release = claim.status === "held" ? claim.release : () => {};
      if (lock.released) {
        // Let go of while the claim was in flight.
        release();
        return "busy";
      }
      if (claim.status === "busy") {
        if (this.lock === lock) this.lock = null;
        return "busy";
      }
      lock.status = claim.status;
      lock.release = release;
      return claim.status;
    });
    return lock.claimed;
  };

  /** Whether this tab may upload or delete this copy. */
  owns = (id: string): boolean => {
    const lock = this.lock;
    if (lock?.id !== id) return false;
    return (
      lock.status === "held" ||
      (lock.status === "unavailable" && this.recordedHere.has(id))
    );
  };

  release = (): void => {
    const lock = this.lock;
    this.lock = null;
    if (lock) letGo(lock);
  };

  /**
   * Stop using the current copy now, but keep its lock until `work` settles,
   * so no other tab takes a copy this one is still writing or deleting.
   */
  releaseAfter = (
    ...work: Array<Promise<unknown> | null | undefined>
  ): Promise<void> => {
    const lock = this.lock;
    this.lock = null;
    const pending = work.filter((w): w is Promise<unknown> => !!w);
    return Promise.allSettled(pending).then(() => {
      if (lock) letGo(lock);
    });
  };
}
