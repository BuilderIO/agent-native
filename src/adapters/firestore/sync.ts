import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { watch } from "chokidar";
import { shouldSyncFile, getDocId, loadSyncConfig } from "./config.js";
import { threeWayMerge } from "./merge.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileSyncOptions {
  /** Unique app identifier (e.g. "content-workspace") */
  appId: string;
  /** Default owner ID for shared sync channel */
  ownerId: string;
  /** Root directory for synced content */
  contentRoot: string;
  /** Firestore collection reference for app files */
  getFileCollection: () => FirestoreCollection;
  /** Path to sync-config.json. Default: <contentRoot>/sync-config.json */
  syncConfigPath?: string;
}

/** Minimal Firestore collection interface (avoids hard firebase-admin dependency) */
export interface FirestoreCollection {
  doc(id: string): FirestoreDocRef;
  where(field: string, op: string, value: any): FirestoreQuery;
}

export interface FirestoreDocRef {
  get(): Promise<FirestoreDocSnapshot>;
  set(data: any, options?: { merge?: boolean }): Promise<any>;
  delete(): Promise<any>;
  collection(name: string): FirestoreCollection;
}

export interface FirestoreQuery {
  where(field: string, op: string, value: any): FirestoreQuery;
  get(): Promise<FirestoreQuerySnapshot>;
  onSnapshot(
    onNext: (snapshot: FirestoreQuerySnapshot) => void,
    onError: (error: any) => void,
  ): () => void;
}

export interface FirestoreDocSnapshot {
  exists: boolean;
  id: string;
  data(): any;
}

export interface FirestoreQuerySnapshot {
  docs: FirestoreDocSnapshot[];
  size: number;
  docChanges(): Array<{
    type: "added" | "modified" | "removed";
    doc: FirestoreDocSnapshot;
  }>;
}

export type SyncEvent =
  | {
      type: "conflict-resolved";
      path: string;
      strategy: "auto-merge" | "local-wins" | "remote-wins";
    }
  | {
      type: "conflict-needs-llm";
      path: string;
      localSnippet: string;
      remoteSnippet: string;
    }
  | { type: "conflict-saved"; path: string; conflictFile: string };

// ---------------------------------------------------------------------------
// Core sync implementation
// ---------------------------------------------------------------------------

const TTL_MS = 3000;

export class FileSync {
  private recentlyPulled = new Map<string, number>();
  private recentlyPushed = new Map<string, number>();
  private lastSyncedContent = new Map<string, string>();
  private sharedSyncInitialized = false;
  private privateSyncInitialized = false;
  private purgeTimer: ReturnType<typeof setInterval> | null = null;

  readonly syncEvents = new EventEmitter();

  constructor(private options: FileSyncOptions) {}

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Initialize the shared sync channel.
   * Runs startup sync, starts Firestore listener, and starts file watcher.
   */
  async initFileSync(): Promise<void> {
    if (this.sharedSyncInitialized) return;
    this.sharedSyncInitialized = true;

    const config = loadSyncConfig(this.options.syncConfigPath);
    const patterns = config.syncFilePatterns;

    if (patterns.length === 0) {
      console.log("[file-sync] No syncFilePatterns configured - file sync disabled");
      return;
    }

    console.log(`[file-sync:shared] Initializing with ${patterns.length} pattern(s)`);

    this.startPurgeTimer();
    await this.initStartupSync(patterns, this.options.ownerId, "shared");
    this.startFirestoreListener(patterns, this.options.ownerId, "shared");
    this.startFileWatcher(patterns, this.options.ownerId, "shared");
  }

  /**
   * Initialize the private sync channel using a per-user UID.
   */
  async initPrivateSync(userUid: string): Promise<void> {
    if (this.privateSyncInitialized) return;
    this.privateSyncInitialized = true;

    const config = loadSyncConfig(this.options.syncConfigPath);
    const patterns = config.privateSyncFilePatterns;

    if (patterns.length === 0) {
      console.log("[file-sync:private] No privateSyncFilePatterns configured");
      return;
    }

    console.log(`[file-sync:private] Initializing private sync for user ${userUid.slice(0, 8)}...`);

    await this.initStartupSync(patterns, userUid, "private");
    this.startFirestoreListener(patterns, userUid, "private");
    this.startFileWatcher(patterns, userUid, "private");
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private emitSyncEvent(event: SyncEvent) {
    this.syncEvents.emit("sync", event);
  }

  private markRecent(map: Map<string, number>, filePath: string) {
    map.set(filePath, Date.now());
  }

  private wasRecent(map: Map<string, number>, filePath: string): boolean {
    const ts = map.get(filePath);
    if (!ts) return false;
    if (Date.now() - ts > TTL_MS) {
      map.delete(filePath);
      return false;
    }
    return true;
  }

  private startPurgeTimer() {
    this.purgeTimer = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.recentlyPulled) {
        if (now - v > TTL_MS) this.recentlyPulled.delete(k);
      }
      for (const [k, v] of this.recentlyPushed) {
        if (now - v > TTL_MS) this.recentlyPushed.delete(k);
      }
    }, TTL_MS * 2);
  }

  private readLocalFile(absPath: string): string | null {
    try {
      return fs.readFileSync(absPath, "utf-8");
    } catch {
      return null;
    }
  }

  private writeSyncedFile(filePath: string, absPath: string, content: string) {
    this.markRecent(this.recentlyPulled, filePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, "utf-8");
    this.lastSyncedContent.set(filePath, content);
  }

  private docId(filePath: string): string {
    return getDocId(this.options.appId, filePath);
  }

  private collection() {
    return this.options.getFileCollection();
  }

  // ── Conflict resolution ─────────────────────────────────────────────

  private resolveConflict(
    filePath: string,
    absPath: string,
    localContent: string,
    remoteContent: string,
    ownerId: string,
  ): void {
    const base = this.lastSyncedContent.get(filePath);

    if (base !== undefined) {
      const result = threeWayMerge(base, localContent, remoteContent);

      if (result.success && result.merged !== null) {
        this.writeSyncedFile(filePath, absPath, result.merged);

        const now = Date.now();
        this.collection()
          .doc(this.docId(filePath))
          .set(
            {
              path: filePath,
              content: result.merged,
              app: this.options.appId,
              ownerId,
              lastUpdated: now,
            },
            { merge: true },
          )
          .then(() => this.markRecent(this.recentlyPushed, filePath))
          .catch((err) =>
            console.error(`[file-sync] Failed to push merged ${filePath}:`, err),
          );

        this.emitSyncEvent({
          type: "conflict-resolved",
          path: filePath,
          strategy: "auto-merge",
        });
        console.log(`[file-sync] auto-merged ${filePath}`);
        return;
      }
    }

    // Auto-merge failed or no base — write .conflict sidecar
    const conflictPath = absPath + ".conflict";
    fs.writeFileSync(conflictPath, remoteContent, "utf-8");
    console.log(`[file-sync] conflict in ${filePath} - wrote ${filePath}.conflict`);

    this.emitSyncEvent({
      type: "conflict-saved",
      path: filePath,
      conflictFile: filePath + ".conflict",
    });

    this.emitSyncEvent({
      type: "conflict-needs-llm",
      path: filePath,
      localSnippet: localContent.slice(0, 500),
      remoteSnippet: remoteContent.slice(0, 500),
    });
  }

  // ── Startup sync ────────────────────────────────────────────────────

  private async initStartupSync(
    patterns: string[],
    ownerId: string,
    label: string,
  ): Promise<void> {
    if (patterns.length === 0) return;

    console.log(`[file-sync:${label}] Running full startup sync...`);

    const baseQuery = this.collection()
      .where("app", "==", this.options.appId)
      .where("ownerId", "==", ownerId);

    const snapshot = await baseQuery.get();

    const docsByPath = new Map<string, FirestoreDocSnapshot>();
    const orphanedDocIds: string[] = [];

    for (const doc of snapshot.docs) {
      const filePath = doc.data().path as string;
      const canonicalId = this.docId(filePath);
      if (doc.id !== canonicalId) {
        orphanedDocIds.push(doc.id);
        continue;
      }
      docsByPath.set(filePath, doc);
    }

    if (orphanedDocIds.length > 0) {
      console.log(`[file-sync:${label}] Cleaning up ${orphanedDocIds.length} orphaned doc(s)...`);
      for (const id of orphanedDocIds) {
        await this.collection().doc(id).delete().catch(() => {});
      }
    }

    const projectRoot = path.resolve(this.options.contentRoot, "..");
    let syncedCount = 0;

    for (const [filePath, doc] of docsByPath) {
      const data = doc.data();
      if (!shouldSyncFile(filePath, patterns)) continue;

      const absPath = path.resolve(projectRoot, filePath);
      const firestoreContent: string = data.content ?? "";
      const localContent = this.readLocalFile(absPath);

      if (localContent === null) {
        this.writeSyncedFile(filePath, absPath, firestoreContent);
        syncedCount++;
      } else if (localContent !== firestoreContent) {
        const firestoreMs: number = data.lastUpdated ?? 0;
        let localMs = 0;
        try {
          localMs = fs.statSync(absPath).mtimeMs;
        } catch {}

        if (firestoreMs > localMs) {
          this.writeSyncedFile(filePath, absPath, firestoreContent);
          syncedCount++;
        } else {
          const now = Date.now();
          await this.collection()
            .doc(this.docId(filePath))
            .set(
              {
                path: filePath,
                content: localContent,
                app: this.options.appId,
                ownerId,
                lastUpdated: now,
                createdAt: data.createdAt ?? now,
              },
              { merge: true },
            );
          this.lastSyncedContent.set(filePath, localContent);
          this.markRecent(this.recentlyPushed, filePath);
          syncedCount++;
        }
      } else {
        this.lastSyncedContent.set(filePath, localContent);
      }
    }

    console.log(
      `[file-sync:${label}] Startup sync complete - ${syncedCount} file(s) synced`,
    );
  }

  // ── Firestore -> disk listener ──────────────────────────────────────

  private startFirestoreListener(
    patterns: string[],
    ownerId: string,
    label: string,
  ): void {
    if (patterns.length === 0) return;

    console.log(`[file-sync:${label}] Listening for Firestore changes...`);
    const projectRoot = path.resolve(this.options.contentRoot, "..");

    this.collection()
      .where("app", "==", this.options.appId)
      .where("ownerId", "==", ownerId)
      .onSnapshot(
        (snapshot) => {
          for (const change of snapshot.docChanges()) {
            const data = change.doc.data();
            const filePath: string = data.path;

            if (!shouldSyncFile(filePath, patterns)) continue;

            if (change.type === "added" || change.type === "modified") {
              if (change.doc.id !== this.docId(filePath)) continue;
              if (this.wasRecent(this.recentlyPushed, filePath)) continue;

              const absPath = path.resolve(projectRoot, filePath);
              const incoming = data.content ?? "";

              const local = this.readLocalFile(absPath);
              if (local === incoming) {
                this.lastSyncedContent.set(filePath, incoming);
                continue;
              }

              if (local === null) {
                this.writeSyncedFile(filePath, absPath, incoming);
                continue;
              }

              const lastSynced = this.lastSyncedContent.get(filePath);

              if (lastSynced === undefined || local === lastSynced) {
                this.writeSyncedFile(filePath, absPath, incoming);
              } else {
                this.resolveConflict(filePath, absPath, local, incoming, ownerId);
              }
            }

            if (change.type === "removed") {
              const absPath = path.resolve(projectRoot, filePath);
              if (fs.existsSync(absPath)) {
                fs.unlinkSync(absPath);
                this.lastSyncedContent.delete(filePath);
              }
            }
          }
        },
        (err) => {
          console.error(`[file-sync:${label}] Firestore listener error:`, err);
        },
      );
  }

  // ── Disk -> Firestore watcher ───────────────────────────────────────

  private startFileWatcher(
    patterns: string[],
    ownerId: string,
    label: string,
  ): void {
    if (patterns.length === 0) return;

    const projectRoot = path.resolve(this.options.contentRoot, "..");

    console.log(`[file-sync:${label}] Watching local files for changes...`);

    const watcher = watch(this.options.contentRoot, {
      ignoreInitial: true,
    });

    const handleChange = async (absPath: string) => {
      const relPath = path.relative(projectRoot, absPath);
      if (!shouldSyncFile(relPath, patterns)) return;
      if (this.wasRecent(this.recentlyPulled, relPath)) return;

      const content = this.readLocalFile(absPath);
      if (content === null) return;

      const docRef = this.collection().doc(this.docId(relPath));
      const existing = await docRef.get();

      if (existing.exists && existing.data()?.content === content) return;

      const now = Date.now();
      const payload: Record<string, any> = {
        path: relPath,
        content,
        app: this.options.appId,
        ownerId,
        lastUpdated: now,
      };
      if (!existing.exists) {
        payload.createdAt = now;
      }

      docRef
        .set(payload, { merge: true })
        .then(() => {
          this.lastSyncedContent.set(relPath, content);
          this.markRecent(this.recentlyPushed, relPath);
          console.log(`[file-sync:${label}] -> pushed ${relPath}`);
        })
        .catch((err) =>
          console.error(`[file-sync:${label}] Failed to push ${relPath}:`, err),
        );
    };

    const handleDelete = (absPath: string) => {
      const relPath = path.relative(projectRoot, absPath);
      if (!shouldSyncFile(relPath, patterns)) return;

      this.collection()
        .doc(this.docId(relPath))
        .delete()
        .then(() => {
          this.lastSyncedContent.delete(relPath);
          console.log(`[file-sync:${label}] -> deleted ${relPath}`);
        })
        .catch((err) =>
          console.error(`[file-sync:${label}] Failed to delete ${relPath}:`, err),
        );
    };

    watcher.on("add", handleChange);
    watcher.on("change", handleChange);
    watcher.on("unlink", handleDelete);
  }
}
