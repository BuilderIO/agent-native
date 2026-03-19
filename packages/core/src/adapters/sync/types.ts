import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

export type SafePath = string & { readonly __brand: "SafePath" };
export type ContentHash = string & { readonly __brand: "ContentHash" };
export type ValidIdentifier = string & { readonly __brand: "ValidIdentifier" };

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface FileRecord {
  path: string;
  content: string;
  app: string;
  ownerId: string;
  lastUpdated: number;
  createdAt?: number;
}

export type FileWritePayload = Partial<FileRecord>;

export interface FileChange {
  type: "added" | "modified" | "removed";
  id: string;
  data: FileRecord;
}

export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface FileSyncAdapter {
  query(
    appId: string,
    ownerId: string,
  ): Promise<{ id: string; data: FileRecord }[]>;
  get(id: string): Promise<{ id: string; data: FileRecord } | null>;
  set(id: string, record: FileWritePayload): Promise<void>;
  delete(id: string): Promise<void>;
  subscribe(
    appId: string,
    ownerId: string,
    onChange: (changes: FileChange[]) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type FileSyncEvent =
  | { readonly source: "file"; readonly type: "created" | "modified" | "deleted"; readonly path: string }
  | { readonly source: "sync"; readonly type: "updated" | "conflict" | "conflict-needs-llm" | "conflict-resolved" | "conflict-saved" | "error"; readonly path: string };

export interface FileSyncEvents {
  sync: [event: FileSyncEvent];
  error: [error: unknown];
  "sync-burst-start": [];
  "sync-burst-end": [];
  [key: string]: unknown[];
}

// ---------------------------------------------------------------------------
// Typed event emitter
// ---------------------------------------------------------------------------

export class TypedEventEmitter<T extends Record<string, unknown[]>> {
  private emitter = new EventEmitter();

  on<K extends keyof T & string>(
    event: K,
    listener: (...args: T[K]) => void,
  ): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof T & string>(
    event: K,
    listener: (...args: T[K]) => void,
  ): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  emit<K extends keyof T & string>(event: K, ...args: T[K]): boolean {
    return this.emitter.emit(event, ...args);
  }

  removeAllListeners<K extends keyof T & string>(event?: K): this {
    this.emitter.removeAllListeners(event);
    return this;
  }
}
