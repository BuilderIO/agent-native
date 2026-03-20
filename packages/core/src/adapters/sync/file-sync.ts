import fs from "fs";
import path from "path";
import { watch, type FSWatcher } from "chokidar";
import pLimit from "p-limit";
import {
  shouldSyncFile,
  getDocId,
  loadSyncConfig,
  hashContent,
  assertSafePath,
  assertNotSymlink,
  validateIdentifier,
} from "./config.js";
import { threeWayMerge } from "./merge.js";
import {
  TypedEventEmitter,
  type FileSyncAdapter,
  type FileRecord,
  type FileWritePayload,
  type FileSyncEvents,
  type ContentHash,
  type Unsubscribe,
} from "./types.js";

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
  /** Adapter for file sync operations */
  adapter: FileSyncAdapter;
  /** Path to sync-config.json. Default: <contentRoot>/sync-config.json */
  syncConfigPath?: string;
  /** Concurrency limit for startup sync operations. Default: 10 */
  startupConcurrency?: number;
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

const TTL_MS = 5000;
const MAX_RETRY_QUEUE = 100;
const MAX_MERGE_BASES = 50;
const MERGE_BASE_SIZE_LIMIT = 50 * 1024; // 50 KB

export class FileSync {
  // -- State tracking --------------------------------------------------------
  private lastSyncedHash = new Map<string, ContentHash>();
  private mergeBaseCache = new Map<string, string>();
  private recentlyPushed = new Map<string, number>();
  private expectedWrites = new Set<string>();
  private pushInFlight = new Map<string, Promise<void>>();
  private sharedSyncInitialized = false;
  private privateSyncInitialized = false;

  // -- Retry queue -----------------------------------------------------------
  private retryQueue = new Map<
    string,
    { docId: string; payload: FileWritePayload }
  >();
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  // -- Lifecycle -------------------------------------------------------------
  private abortController = new AbortController();
  private stopped = false;
  private watchers: FSWatcher[] = [];
  private unsubscribeRemote: Unsubscribe[] = [];
  private purgeTimer: ReturnType<typeof setInterval> | null = null;

  // -- Sync status -----------------------------------------------------------
  private hasError = false;
  private lastSyncTimestamp: number | null = null;
  private conflictPaths = new Set<string>();

  // -- Public ----------------------------------------------------------------
  readonly syncEvents = new TypedEventEmitter<FileSyncEvents>();

  get conflictCount(): number {
    return this.conflictPaths.size;
  }

  constructor(private options: FileSyncOptions) {
    // Validate identifiers at construction time
    validateIdentifier("appId", options.appId);
    validateIdentifier("ownerId", options.ownerId);
  }

  // -- Public API -----------------------------------------------------------

  /**
   * Initialize the shared sync channel.
   * Runs startup sync, starts remote listener, and starts file watcher.
   */
  async initFileSync(): Promise<void> {
    if (this.sharedSyncInitialized) return;
    // Do NOT set flag here — only on success (1e)

    const config = loadSyncConfig(this.options.syncConfigPath);
    const patterns = config.syncFilePatterns;

    if (patterns.length === 0) {
      console.log(
        "[file-sync] No syncFilePatterns configured - file sync disabled",
      );
      return;
    }

    console.log(
      `[file-sync:shared] Initializing with ${patterns.length} pattern(s)`,
    );

    try {
      this.startPurgeTimer();
      await this.initStartupSync(patterns, this.options.ownerId, "shared");
      if (this.stopped) return;
      this.startRemoteListener(patterns, this.options.ownerId, "shared");
      this.startFileWatcher(patterns, this.options.ownerId, "shared");
      this.sharedSyncInitialized = true; // only on success (1e)
      this.writeSyncStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("relation") && msg.includes("does not exist")) {
        console.error(
          `[file-sync] Supabase table not found. Create it by running this SQL in your Supabase dashboard:\n\n` +
            `  CREATE TABLE files (\n` +
            `    id TEXT PRIMARY KEY,\n` +
            `    path TEXT NOT NULL,\n` +
            `    content TEXT NOT NULL,\n` +
            `    app TEXT NOT NULL,\n` +
            `    owner_id TEXT NOT NULL,\n` +
            `    last_updated BIGINT NOT NULL,\n` +
            `    created_at BIGINT\n` +
            `  );\n` +
            `  CREATE INDEX idx_files_app_owner ON files(app, owner_id);\n`,
        );
      } else {
        console.error("[file-sync] Init failed, will allow retry:", err);
      }
      this.hasError = true;
      this.writeSyncStatus();
      // flag stays false — next call retries
    }
  }

  /**
   * Initialize the private sync channel using a per-user UID.
   */
  async initPrivateSync(userUid: string): Promise<void> {
    if (this.privateSyncInitialized) return;
    // Do NOT set flag here — only on success (1e)

    // Validate userUid (1c — missed in pass 1)
    validateIdentifier("userUid", userUid);

    const config = loadSyncConfig(this.options.syncConfigPath);
    const patterns = config.privateSyncFilePatterns;

    if (patterns.length === 0) {
      console.log("[file-sync:private] No privateSyncFilePatterns configured");
      return;
    }

    console.log(
      `[file-sync:private] Initializing private sync for user ${userUid.slice(0, 8)}...`,
    );

    try {
      await this.initStartupSync(patterns, userUid, "private");
      if (this.stopped) return;
      this.startRemoteListener(patterns, userUid, "private");
      this.startFileWatcher(patterns, userUid, "private");
      this.privateSyncInitialized = true; // only on success (1e)
    } catch (err) {
      console.error("[file-sync:private] Init failed, will allow retry:", err);
      // flag stays false — next call retries
    }
  }

  /**
   * Graceful shutdown. Cancels in-flight operations, drains retry queue,
   * closes watchers, unsubscribes listeners, and disposes the adapter.
   */
  async stop(): Promise<void> {
    this.stopped = true;

    // Clear timers
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = null;
    }

    // Final flush attempt with timeout BEFORE aborting (abort would skip the flush)
    await Promise.race([
      this.flushRetryQueue(),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (this.retryQueue.size > 0) {
      console.warn(
        `[file-sync] ${this.retryQueue.size} unsynced changes lost on shutdown`,
      );
      this.writeDeadLetterLog("shutdown");
    }

    // Drain in-flight pushes
    const inFlightPromises = [...this.pushInFlight.values()];
    if (inFlightPromises.length > 0) {
      await Promise.race([
        Promise.allSettled(inFlightPromises),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }

    // Now abort — after graceful drain is complete
    this.abortController.abort();

    // Close watchers (chokidar v4: close() returns Promise)
    for (const watcher of this.watchers) {
      await watcher.close();
    }
    this.watchers = [];

    // Unsubscribe remote listeners
    for (const unsub of this.unsubscribeRemote) {
      unsub();
    }
    this.unsubscribeRemote = [];

    // Dispose adapter (release gRPC channels, WebSocket connections)
    await this.options.adapter.dispose();

    this.sharedSyncInitialized = false;
    this.privateSyncInitialized = false;
  }

  /**
   * Check if a file was recently written by the sync engine (echo suppression).
   * Consumes the entry — can only return true once per write.
   */
  wasSyncPulled(relPath: string): boolean {
    if (this.expectedWrites.has(relPath)) {
      this.expectedWrites.delete(relPath);
      return true;
    }
    return false;
  }

  /**
   * Get paths of currently unresolved conflicts.
   */
  getConflictPaths(): string[] {
    return [...this.conflictPaths];
  }

  // -- Private helpers ------------------------------------------------------

  private emitSyncEvent(event: SyncEvent) {
    this.syncEvents.emit("sync", { source: "sync", ...event } as any);
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
    if (this.purgeTimer) return;
    this.purgeTimer = setInterval(() => {
      const now = Date.now();
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
    const projectRoot = path.resolve(this.options.contentRoot, "..");
    assertSafePath(projectRoot, filePath);
    assertNotSymlink(absPath);

    this.expectedWrites.add(filePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, "utf-8");

    const hash = hashContent(content);
    this.lastSyncedHash.set(filePath, hash);
    this.updateMergeBase(filePath, content);
    this.lastSyncTimestamp = Date.now();
  }

  private docId(filePath: string): string {
    return getDocId(this.options.appId, filePath);
  }

  // -- Merge base cache (1i) ------------------------------------------------

  private updateMergeBase(relPath: string, content: string) {
    // Skip caching for large files
    if (content.length > MERGE_BASE_SIZE_LIMIT) return;

    // Simple LRU: evict oldest if at capacity
    if (this.mergeBaseCache.size >= MAX_MERGE_BASES) {
      const oldest = this.mergeBaseCache.keys().next().value;
      if (oldest) this.mergeBaseCache.delete(oldest);
    }
    this.mergeBaseCache.set(relPath, content);
  }

  // -- Retry queue (1l) -----------------------------------------------------

  private enqueueRetry(
    relPath: string,
    docId: string,
    payload: FileWritePayload,
  ) {
    if (this.retryQueue.size >= MAX_RETRY_QUEUE) {
      const oldest = this.retryQueue.keys().next().value;
      if (oldest) {
        this.retryQueue.delete(oldest);
        this.appendDeadLetter(oldest, "evicted");
      }
    }
    this.retryQueue.set(relPath, { docId, payload });
    if (!this.retryTimer) {
      const jitter = Math.random() * 5000;
      this.retryTimer = setInterval(
        () => this.flushRetryQueue(),
        30_000 + jitter,
      );
    }
    this.writeSyncStatus();
  }

  private async flushRetryQueue() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const snapshot = [...this.retryQueue.entries()];
      for (const [relPath, { docId, payload }] of snapshot) {
        if (this.abortController.signal.aborted) break;
        try {
          await this.options.adapter.set(docId, payload);
          this.retryQueue.delete(relPath);
          if (payload.content) {
            this.lastSyncedHash.set(relPath, hashContent(payload.content));
            this.markRecent(this.recentlyPushed, relPath);
          }
        } catch {
          break; // stop on first failure, retry next cycle
        }
      }
    } finally {
      this.flushing = false;
      if (this.retryQueue.size === 0 && this.retryTimer) {
        clearInterval(this.retryTimer);
        this.retryTimer = null;
      }
    }
  }

  // -- Dead letter log (1q) -------------------------------------------------

  private appendDeadLetter(relPath: string, reason: "evicted" | "shutdown") {
    const entry = { path: relPath, reason, timestamp: Date.now() };
    const logPath = path.resolve(
      this.options.contentRoot,
      ".sync-failures.json",
    );
    try {
      const existing = fs.existsSync(logPath)
        ? JSON.parse(fs.readFileSync(logPath, "utf-8"))
        : [];
      existing.push(entry);
      const trimmed = existing.slice(-200);
      fs.writeFileSync(logPath, JSON.stringify(trimmed, null, 2));
    } catch {
      /* best-effort */
    }
  }

  private writeDeadLetterLog(reason: "evicted" | "shutdown") {
    for (const relPath of this.retryQueue.keys()) {
      this.appendDeadLetter(relPath, reason);
    }
  }

  // -- Sync status file (1r) ------------------------------------------------

  private writeSyncStatus() {
    const status = {
      enabled: true,
      connected: !this.hasError,
      conflicts: this.getConflictPaths(),
      lastSyncedAt: this.lastSyncTimestamp,
      retryQueueSize: this.retryQueue.size,
      failedPaths: [...this.retryQueue.keys()],
    };
    const statusPath = path.resolve(
      this.options.contentRoot,
      ".sync-status.json",
    );
    try {
      fs.mkdirSync(path.dirname(statusPath), { recursive: true });
      fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
    } catch {
      /* best-effort */
    }
  }

  // -- Conflict resolution --------------------------------------------------

  private resolveConflict(
    filePath: string,
    absPath: string,
    localContent: string,
    remoteContent: string,
    ownerId: string,
  ): void {
    // Use merge base cache instead of full content (1i)
    const base = this.mergeBaseCache.get(filePath);

    if (base !== undefined) {
      const result = threeWayMerge(base, localContent, remoteContent);

      if (result.success && result.merged !== null) {
        this.writeSyncedFile(filePath, absPath, result.merged);

        const now = Date.now();
        this.options.adapter
          .set(this.docId(filePath), {
            path: filePath,
            content: result.merged,
            app: this.options.appId,
            ownerId,
            lastUpdated: now,
          })
          .then(() => {
            if (this.abortController.signal.aborted) return;
            this.markRecent(this.recentlyPushed, filePath);
            this.retryQueue.delete(filePath);
          })
          .catch((err) => {
            console.error(
              `[file-sync] Failed to push merged ${filePath}:`,
              err,
            );
            this.enqueueRetry(filePath, this.docId(filePath), {
              path: filePath,
              content: result.merged!,
              app: this.options.appId,
              ownerId,
              lastUpdated: now,
            });
          });

        this.emitSyncEvent({
          type: "conflict-resolved",
          path: filePath,
          strategy: "auto-merge",
        });
        this.conflictPaths.delete(filePath);
        console.log(`[file-sync] auto-merged ${filePath}`);
        return;
      }
    }

    // Auto-merge failed or no base -- write .conflict sidecar
    const projectRoot = path.resolve(this.options.contentRoot, "..");
    const conflictPath = assertSafePath(
      projectRoot,
      filePath + ".conflict",
    ) as string;
    assertNotSymlink(conflictPath);
    fs.writeFileSync(conflictPath, remoteContent, "utf-8");
    console.log(
      `[file-sync] conflict in ${filePath} - wrote ${filePath}.conflict`,
    );

    this.conflictPaths.add(filePath);

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

    this.writeSyncStatus();
  }

  // -- Startup sync ---------------------------------------------------------

  private async initStartupSync(
    patterns: string[],
    ownerId: string,
    label: string,
  ): Promise<void> {
    if (patterns.length === 0) return;

    console.log(`[file-sync:${label}] Running full startup sync...`);

    // Emit burst start for SSE batching
    this.syncEvents.emit("sync-burst-start");

    try {
      const rows = await this.options.adapter.query(
        this.options.appId,
        ownerId,
      );

      const docsByPath = new Map<string, { id: string; data: FileRecord }>();
      const orphanedDocIds: string[] = [];

      // Check for legacy doc ID format
      const legacyDocs = rows.filter((r) => r.id.includes("__"));
      if (legacyDocs.length > 0) {
        console.warn(
          `[file-sync] Found ${legacyDocs.length} document(s) with legacy '__' separator. ` +
            `These will be treated as orphans. See: https://agent-native.dev/docs/file-sync#migration`,
        );
      }

      for (const row of rows) {
        const filePath = row.data.path;
        const canonicalId = this.docId(filePath);
        if (row.id !== canonicalId) {
          orphanedDocIds.push(row.id);
          continue;
        }
        docsByPath.set(filePath, row);
      }

      // Parallelize orphan cleanup with p-limit (1g)
      const limit = pLimit(this.options.startupConcurrency ?? 10);

      if (orphanedDocIds.length > 0) {
        console.log(
          `[file-sync:${label}] Cleaning up ${orphanedDocIds.length} orphaned doc(s)...`,
        );
        await Promise.all(
          orphanedDocIds.map((id) =>
            limit(() =>
              this.options.adapter.delete(id).catch((err) => {
                console.warn(`[file-sync] Failed to delete orphan ${id}:`, err);
              }),
            ),
          ),
        );
      }

      const projectRoot = path.resolve(this.options.contentRoot, "..");
      let syncedCount = 0;

      // Collect push operations for parallel execution
      const pushOps: Array<() => Promise<void>> = [];

      for (const [filePath, row] of docsByPath) {
        if (this.stopped) return;

        const data = row.data;
        if (!shouldSyncFile(filePath, patterns)) continue;

        const absPath = assertSafePath(projectRoot, filePath) as string;
        const remoteContent: string = data.content ?? "";
        const localContent = this.readLocalFile(absPath);

        if (localContent === null) {
          this.writeSyncedFile(filePath, absPath, remoteContent);
          syncedCount++;
        } else if (localContent !== remoteContent) {
          const remoteMs: number = data.lastUpdated ?? 0;
          let localMs = 0;
          try {
            localMs = fs.statSync(absPath).mtimeMs;
          } catch {
            /* file may have been deleted */
          }

          if (remoteMs > localMs) {
            this.writeSyncedFile(filePath, absPath, remoteContent);
            syncedCount++;
          } else {
            // Queue push for parallel execution
            const capturedFilePath = filePath;
            const capturedLocalContent = localContent;
            const capturedCreatedAt = data.createdAt;
            pushOps.push(async () => {
              if (this.abortController.signal.aborted) return;
              const now = Date.now();
              await this.options.adapter.set(this.docId(capturedFilePath), {
                path: capturedFilePath,
                content: capturedLocalContent,
                app: this.options.appId,
                ownerId,
                lastUpdated: now,
                createdAt: capturedCreatedAt ?? now,
              });
              if (this.abortController.signal.aborted) return;
              this.lastSyncedHash.set(
                capturedFilePath,
                hashContent(capturedLocalContent),
              );
              this.updateMergeBase(capturedFilePath, capturedLocalContent);
              this.markRecent(this.recentlyPushed, capturedFilePath);
            });
            syncedCount++;
          }
        } else {
          this.lastSyncedHash.set(filePath, hashContent(localContent));
          this.updateMergeBase(filePath, localContent);
        }
      }

      // Execute pushes in parallel with concurrency limit (1g)
      if (pushOps.length > 0) {
        await Promise.all(pushOps.map((fn) => limit(fn)));
      }

      this.lastSyncTimestamp = Date.now();
      this.writeSyncStatus();

      console.log(
        `[file-sync:${label}] Startup sync complete - ${syncedCount} file(s) synced`,
      );
    } finally {
      // Always emit burst end — even if startup sync failed
      this.syncEvents.emit("sync-burst-end");
    }
  }

  // -- Remote -> disk listener ----------------------------------------------

  private startRemoteListener(
    patterns: string[],
    ownerId: string,
    label: string,
  ): void {
    if (patterns.length === 0) return;

    console.log(`[file-sync:${label}] Listening for remote changes...`);
    const projectRoot = path.resolve(this.options.contentRoot, "..");

    const unsub = this.options.adapter.subscribe(
      this.options.appId,
      ownerId,
      (changes) => {
        for (const change of changes) {
          const data = change.data;
          const filePath: string = data.path;

          if (!shouldSyncFile(filePath, patterns)) continue;

          if (change.type === "added" || change.type === "modified") {
            if (change.id !== this.docId(filePath)) continue;

            // Content-hash dedup instead of TTL-only (1m)
            if (this.wasRecent(this.recentlyPushed, filePath)) {
              const pushedHash = this.lastSyncedHash.get(filePath);
              const incomingHash = hashContent(data.content ?? "");
              if (pushedHash === incomingHash) continue; // genuine echo
              // Different content — real remote change, proceed
            }

            let absPath: string;
            try {
              absPath = assertSafePath(projectRoot, filePath) as string;
            } catch (err) {
              console.error(`[file-sync:${label}] Rejected remote path:`, err);
              continue;
            }

            const incoming = data.content ?? "";

            const local = this.readLocalFile(absPath);
            if (local === incoming) {
              this.lastSyncedHash.set(filePath, hashContent(incoming));
              this.updateMergeBase(filePath, incoming);
              continue;
            }

            if (local === null) {
              this.writeSyncedFile(filePath, absPath, incoming);
              continue;
            }

            const lastHash = this.lastSyncedHash.get(filePath);
            const localHash = hashContent(local);

            if (lastHash === undefined || localHash === lastHash) {
              // No local changes since last sync — safe to overwrite
              this.writeSyncedFile(filePath, absPath, incoming);
            } else {
              this.resolveConflict(filePath, absPath, local, incoming, ownerId);
            }

            this.lastSyncTimestamp = Date.now();
            this.writeSyncStatus();
          }

          if (change.type === "removed") {
            let absPath: string;
            try {
              absPath = assertSafePath(projectRoot, filePath) as string;
            } catch (err) {
              console.error(
                `[file-sync:${label}] Rejected remote delete path:`,
                err,
              );
              continue;
            }
            // Use fs.rm with force to eliminate TOCTOU race
            fs.rm(absPath, { force: true }, () => {});
            this.lastSyncedHash.delete(filePath);
            this.mergeBaseCache.delete(filePath);
            this.retryQueue.delete(filePath);
          }
        }
      },
      (err) => {
        console.error(`[file-sync:${label}] Remote listener error:`, err);
        this.hasError = true;
        this.writeSyncStatus();
      },
    );

    this.unsubscribeRemote.push(unsub);
  }

  // -- Disk -> remote watcher -----------------------------------------------

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

    this.watchers.push(watcher);

    const handleChange = async (absPath: string) => {
      const relPath = path.relative(projectRoot, absPath);
      if (!shouldSyncFile(relPath, patterns)) return;

      // Use expectedWrites Set for echo suppression (1o)
      if (this.wasSyncPulled(relPath)) return;

      // Per-file push serialization (1h) — wait for in-flight push
      const prior = this.pushInFlight.get(relPath);
      if (prior) await prior;

      if (this.abortController.signal.aborted) return;

      const content = this.readLocalFile(absPath);
      if (content === null) return;

      // Content hash comparison instead of adapter.get() (1h)
      const hash = hashContent(content);
      if (this.lastSyncedHash.get(relPath) === hash) return;

      const now = Date.now();
      const payload: FileWritePayload = {
        path: relPath,
        content,
        app: this.options.appId,
        ownerId,
        lastUpdated: now,
      };

      const pushPromise = this.options.adapter
        .set(this.docId(relPath), payload)
        .then(() => {
          if (this.abortController.signal.aborted) return;
          this.lastSyncedHash.set(relPath, hash);
          this.updateMergeBase(relPath, content);
          this.markRecent(this.recentlyPushed, relPath);
          this.retryQueue.delete(relPath);
          this.lastSyncTimestamp = Date.now();
          console.log(`[file-sync:${label}] -> pushed ${relPath}`);
        })
        .catch(() => {
          this.enqueueRetry(relPath, this.docId(relPath), payload);
        })
        .finally(() => {
          if (this.pushInFlight.get(relPath) === pushPromise) {
            this.pushInFlight.delete(relPath);
          }
        });

      this.pushInFlight.set(relPath, pushPromise);
    };

    const handleDelete = (absPath: string) => {
      const relPath = path.relative(projectRoot, absPath);
      if (!shouldSyncFile(relPath, patterns)) return;

      this.options.adapter
        .delete(this.docId(relPath))
        .then(() => {
          this.lastSyncedHash.delete(relPath);
          this.mergeBaseCache.delete(relPath);
          this.retryQueue.delete(relPath);
          console.log(`[file-sync:${label}] -> deleted ${relPath}`);
        })
        .catch((err) =>
          console.error(
            `[file-sync:${label}] Failed to delete ${relPath}:`,
            err,
          ),
        );
    };

    watcher.on("add", handleChange);
    watcher.on("change", handleChange);
    watcher.on("unlink", handleDelete);
  }
}
