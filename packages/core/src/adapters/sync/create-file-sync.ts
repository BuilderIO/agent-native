import fs from "fs";
import path from "path";
import { FileSync, type FileSyncOptions } from "./file-sync.js";
import { validateIdentifier } from "./config.js";
import {
  TypedEventEmitter,
  type FileSyncAdapter,
  type FileSyncEvents,
} from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileSyncBackend = "firestore" | "supabase" | "convex";

export type FileSyncResult =
  | { readonly status: "disabled" }
  | { readonly status: "error"; readonly reason: string }
  | {
      readonly status: "ready";
      readonly fileSync: FileSync;
      readonly sseEmitter: {
        emitter: TypedEventEmitter<FileSyncEvents>;
        event: string;
      };
      readonly shutdown: () => Promise<void>;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidBackend(value: string): value is FileSyncBackend {
  return value === "firestore" || value === "supabase" || value === "convex";
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function readPackageName(): string | null {
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return typeof pkg.name === "string" ? pkg.name : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

async function createAdapter(
  backend: FileSyncBackend,
): Promise<FileSyncAdapter | null> {
  switch (backend) {
    case "firestore": {
      try {
        requireEnv("GOOGLE_APPLICATION_CREDENTIALS");
        const { FirestoreFileSyncAdapter } =
          await import("../firestore/adapter.js");
        // Dynamic import of firebase-admin — only loads if installed
        const adminModule = await import("firebase-admin");
        // ESM dynamic import wraps CJS modules — unwrap .default if present
        const admin = (adminModule as any).default ?? adminModule;
        const app =
          (admin.apps?.length ?? 0) > 0
            ? admin.apps[0]!
            : admin.initializeApp({
                credential: admin.credential.applicationDefault(),
              });
        const db = app.firestore();
        return new FirestoreFileSyncAdapter(() => db.collection("files"));
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
        ) {
          console.error(
            "[file-sync] firebase-admin not installed. Run: pnpm add firebase-admin",
          );
        } else if (
          err instanceof Error &&
          err.message.startsWith("Missing required")
        ) {
          console.error(`[file-sync] ${err.message}`);
        } else {
          const safeMsg =
            err instanceof Error ? err.message.slice(0, 200) : "Unknown error";
          console.error(
            `[file-sync] Failed to initialize Firestore: ${safeMsg}`,
          );
        }
        return null;
      }
    }
    case "supabase": {
      try {
        const url = requireEnv("SUPABASE_URL");
        // Support new key name (SUPABASE_PUBLISHABLE_KEY) and legacy (SUPABASE_ANON_KEY)
        const key =
          process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
        if (!key) {
          throw new Error(
            "Missing required environment variable: SUPABASE_PUBLISHABLE_KEY (or legacy SUPABASE_ANON_KEY)",
          );
        }
        const { SupabaseFileSyncAdapter } =
          await import("../supabase/adapter.js");
        const supabase = await import("@supabase/supabase-js");
        // The adapter uses a duck-typed SupabaseClient interface to avoid hard deps.
        // The real createClient returns a compatible but differently-typed object.
        const client = supabase.createClient(url, key);
        return new SupabaseFileSyncAdapter(client as never);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
        ) {
          console.error(
            "[file-sync] @supabase/supabase-js not installed. Run: pnpm add @supabase/supabase-js",
          );
        } else if (
          err instanceof Error &&
          err.message.startsWith("Missing required")
        ) {
          console.error(`[file-sync] ${err.message}`);
        } else {
          const safeMsg =
            err instanceof Error ? err.message.slice(0, 200) : "Unknown error";
          console.error(
            `[file-sync] Failed to initialize Supabase: ${safeMsg}`,
          );
        }
        return null;
      }
    }
    case "convex": {
      try {
        const url = requireEnv("CONVEX_URL");
        if (!url.startsWith("https://")) {
          console.error("[file-sync] CONVEX_URL must use HTTPS");
          return null;
        }
        const { ConvexFileSyncAdapter } = await import("../convex/adapter.js");
        const { ConvexClient } = await import("convex/browser");
        const client = new ConvexClient(url);
        return new ConvexFileSyncAdapter(client as never);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
        ) {
          console.error(
            "[file-sync] convex not installed. Run: pnpm add convex",
          );
        } else if (
          err instanceof Error &&
          err.message.startsWith("Missing required")
        ) {
          console.error(`[file-sync] ${err.message}`);
        } else {
          const safeMsg =
            err instanceof Error ? err.message.slice(0, 200) : "Unknown error";
          console.error(`[file-sync] Failed to initialize Convex: ${safeMsg}`);
        }
        return null;
      }
    }
    default: {
      const _exhaustive: never = backend;
      console.error(`[file-sync] Unknown backend: ${String(_exhaustive)}`);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create a file sync instance from environment variables.
 *
 * Returns a bundled result with the sync instance, SSE emitter, and shutdown
 * function. Returns `{ status: "disabled" }` when `FILE_SYNC_ENABLED` is not
 * `"true"`, and `{ status: "error", reason }` on misconfiguration.
 *
 * This is the first async `create*` function in the codebase — all others
 * (createServer, createFileWatcher, createSSEHandler) are synchronous.
 * Async is unavoidable here due to dynamic imports and adapter initialization.
 */
export async function createFileSync(options: {
  contentRoot: string;
}): Promise<FileSyncResult> {
  if (process.env.FILE_SYNC_ENABLED !== "true") {
    return { status: "disabled" };
  }

  const backend = process.env.FILE_SYNC_BACKEND;
  if (!backend || !isValidBackend(backend)) {
    const reason = `FILE_SYNC_ENABLED=true but FILE_SYNC_BACKEND is missing or invalid ("${backend}")`;
    console.warn(`[file-sync] ${reason}`);
    return { status: "error", reason };
  }

  const adapter = await createAdapter(backend);
  if (!adapter) {
    return {
      status: "error",
      reason: `Failed to initialize ${backend} adapter`,
    };
  }

  let appId = readPackageName() || "app";
  // Strip @scope/ prefix from scoped npm packages
  appId = appId.replace(/^@[^/]+\//, "");
  const ownerId = "shared";

  try {
    validateIdentifier("appId", appId);
    validateIdentifier("ownerId", ownerId);
  } catch (err) {
    const safeMsg =
      err instanceof Error ? err.message.slice(0, 200) : "Unknown error";
    console.error(`[file-sync] Invalid identifier: ${safeMsg}`);
    return { status: "error", reason: `Invalid identifier: ${safeMsg}` };
  }

  const syncOptions: FileSyncOptions = {
    appId,
    ownerId,
    contentRoot: options.contentRoot,
    adapter,
  };

  const sync = new FileSync(syncOptions);

  try {
    await sync.initFileSync();
  } catch (err) {
    const safeMsg =
      err instanceof Error ? err.message.slice(0, 200) : "Unknown error";
    console.error(`[file-sync] Init failed: ${safeMsg}`);
    return { status: "error", reason: `Init failed: ${safeMsg}` };
  }

  return {
    status: "ready",
    fileSync: sync,
    sseEmitter: { emitter: sync.syncEvents, event: "sync" },
    shutdown: () => sync.stop(),
  };
}
