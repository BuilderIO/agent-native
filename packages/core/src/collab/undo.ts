/**
 * Shared per-user undo/redo for collaborative surfaces.
 *
 * Two primitives, one rule: undo NEVER reverts another participant's (human
 * or agent) work, and never restores whole-document snapshots that would
 * clobber concurrent edits.
 *
 * - `useCollabUndo` — Y.UndoManager lifecycle wrapper for Yjs-backed surfaces.
 *   Tracks only transactions tagged with the local origin, coalesces rapid
 *   edits, and is recreated/destroyed when the document changes (stale
 *   managers hold Y.Doc references and grow unboundedly).
 *
 * - `useLocalOpUndo` / `createLocalOpUndoController` — inverse-operation undo
 *   for op-based apps (slides decks, forms). Each local mutation registers
 *   the granular ops that redo and undo it; Cmd+Z replays the inverse ops
 *   through the app's normal granular mutation path, so concurrent edits by
 *   other participants to OTHER items are never touched.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

// ---------------------------------------------------------------------------
// Keyboard shortcut helper (shared by both hooks)
// ---------------------------------------------------------------------------

export interface UndoKeyboardOptions {
  /** Bind Mod+Z / Shift+Mod+Z / Mod+Y on window while mounted. */
  enableKeyboardShortcuts?: boolean;
  /**
   * Skip the shortcut when the event target is an input, textarea, or
   * contentEditable (those own their own undo). Default true.
   */
  ignoreInputTargets?: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    !!el.isContentEditable
  );
}

function useUndoKeyboard(
  undo: () => void,
  redo: () => void,
  options: UndoKeyboardOptions | undefined,
): void {
  const enabled = options?.enableKeyboardShortcuts ?? false;
  const ignoreInputs = options?.ignoreInputTargets ?? true;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (ignoreInputs && isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, ignoreInputs, undo, redo]);
}

// ---------------------------------------------------------------------------
// Yjs-backed undo — useCollabUndo
// ---------------------------------------------------------------------------

export type CollabUndoScope =
  | Y.AbstractType<any>
  | Y.AbstractType<any>[]
  | ((doc: Y.Doc) => Y.AbstractType<any> | Y.AbstractType<any>[]);

export interface UseCollabUndoOptions extends UndoKeyboardOptions {
  /** The collaborative document. Null/undefined while loading. */
  ydoc: Y.Doc | null | undefined;
  /**
   * Shared type(s) to track, or a factory receiving the doc (evaluated when
   * the doc changes) — e.g. `(doc) => doc.getText("content")`.
   */
  scope: CollabUndoScope;
  /**
   * Origins captured as undoable. Defaults to the hook's own `localOrigin`.
   * Transactions from remote peers ("remote") and the agent ("agent"/
   * "server") are never captured.
   */
  trackedOrigins?: unknown[];
  /** Coalesce rapid edits into one undo step. Default 500ms. */
  captureTimeout?: number;
}

export interface UseCollabUndoResult {
  /** Undo the local user's most recent edit. Returns true if applied. */
  undo: () => boolean;
  /** Redo the local user's most recently undone edit. */
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Tag local transactions with this origin so they're captured:
   * `ydoc.transact(() => { ... }, localOrigin)` — or use `transactLocal`.
   */
  localOrigin: unknown;
  /** Run a mutation in a transaction tagged with the local origin. */
  transactLocal: <T>(fn: () => T) => T;
  /** The underlying manager (null while the doc is loading). */
  undoManager: Y.UndoManager | null;
}

export function useCollabUndo(
  options: UseCollabUndoOptions,
): UseCollabUndoResult {
  const { ydoc, scope, trackedOrigins, captureTimeout = 500 } = options;

  // Stable per-hook local origin (an object identity — never collides).
  const localOrigin = useMemo<unknown>(
    () => ({ collabUndoLocalOrigin: true }),
    [],
  );

  const managerRef = useRef<Y.UndoManager | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Keep latest scope/origins in refs so the effect only re-runs on doc change.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const trackedRef = useRef(trackedOrigins);
  trackedRef.current = trackedOrigins;

  useEffect(() => {
    if (!ydoc) {
      managerRef.current = null;
      setCanUndo(false);
      setCanRedo(false);
      return;
    }

    const rawScope = scopeRef.current;
    const resolved = typeof rawScope === "function" ? rawScope(ydoc) : rawScope;
    const scopes = Array.isArray(resolved) ? resolved : [resolved];

    const origins = new Set<unknown>(trackedRef.current ?? [localOrigin]);
    const manager = new Y.UndoManager(scopes, {
      trackedOrigins: origins,
      captureTimeout,
    });
    // The manager applies undo/redo transactions with itself as origin;
    // track it so redo of an undone step is capturable.
    origins.add(manager);
    managerRef.current = manager;

    function refresh() {
      setCanUndo(manager.undoStack.length > 0);
      setCanRedo(manager.redoStack.length > 0);
    }
    refresh();

    manager.on("stack-item-added", refresh);
    manager.on("stack-item-popped", refresh);
    manager.on("stack-cleared", refresh);

    return () => {
      manager.off("stack-item-added", refresh);
      manager.off("stack-item-popped", refresh);
      manager.off("stack-cleared", refresh);
      manager.destroy();
      if (managerRef.current === manager) {
        managerRef.current = null;
      }
    };
  }, [ydoc, captureTimeout, localOrigin]);

  const undo = useCallback((): boolean => {
    const m = managerRef.current;
    if (!m || m.undoStack.length === 0) return false;
    m.undo();
    return true;
  }, []);

  const redo = useCallback((): boolean => {
    const m = managerRef.current;
    if (!m || m.redoStack.length === 0) return false;
    m.redo();
    return true;
  }, []);

  const transactLocal = useCallback(
    <T>(fn: () => T): T => {
      if (!ydoc) return fn();
      let result!: T;
      ydoc.transact(() => {
        result = fn();
      }, localOrigin);
      return result;
    },
    [ydoc, localOrigin],
  );

  useUndoKeyboard(undo, redo, options);

  return {
    undo,
    redo,
    canUndo,
    canRedo,
    localOrigin,
    transactLocal,
    undoManager: managerRef.current,
  };
}

// ---------------------------------------------------------------------------
// Inverse-op undo — createLocalOpUndoController / useLocalOpUndo
// ---------------------------------------------------------------------------

export interface LocalOpUndoEntry<TOp> {
  /** Granular ops that reverse the mutation. */
  undo: TOp[];
  /** Granular ops that re-apply the mutation. */
  redo: TOp[];
  /** Optional label for UI ("Delete slide 3"). */
  label?: string;
  /**
   * Coalescing key: consecutive pushes with the same non-empty key within
   * `coalesceMs` merge into one entry (keeps the FIRST undo ops and the
   * LATEST redo ops) — e.g. per-keystroke text patches on one field.
   */
  coalesceKey?: string;
}

export interface LocalOpUndoController<TOp> {
  /** Record a local mutation. Clears the redo stack. */
  push(entry: LocalOpUndoEntry<TOp>): void;
  /** Apply the inverse ops of the most recent entry. */
  undo(): Promise<boolean>;
  /** Re-apply the most recently undone entry. */
  redo(): Promise<boolean>;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  /** Peek labels for UI (undo tooltip). */
  peekUndoLabel(): string | undefined;
  peekRedoLabel(): string | undefined;
}

export interface CreateLocalOpUndoOptions<TOp> {
  /**
   * Apply granular ops through the app's normal mutation path. MUST NOT
   * push back into this controller (re-entrant pushes are ignored).
   */
  apply: (
    ops: TOp[],
    direction: "undo" | "redo",
    entry: LocalOpUndoEntry<TOp>,
  ) => void | Promise<void>;
  /** Max retained entries. Default 200. */
  maxDepth?: number;
  /** Window for coalescing same-key pushes. Default 800ms. */
  coalesceMs?: number;
  /** Called after any stack change (for canUndo/canRedo UI updates). */
  onChange?: () => void;
  /** Clock override for tests. */
  now?: () => number;
}

interface StampedEntry<TOp> extends LocalOpUndoEntry<TOp> {
  at: number;
}

export function createLocalOpUndoController<TOp>(
  options: CreateLocalOpUndoOptions<TOp>,
): LocalOpUndoController<TOp> {
  const {
    apply,
    maxDepth = 200,
    coalesceMs = 800,
    onChange,
    now = () => Date.now(),
  } = options;

  const undoStack: StampedEntry<TOp>[] = [];
  const redoStack: StampedEntry<TOp>[] = [];
  let applying = false;

  function notify() {
    onChange?.();
  }

  return {
    push(entry) {
      // Ignore pushes triggered by our own undo/redo application.
      if (applying) return;

      const at = now();
      const top = undoStack[undoStack.length - 1];
      if (
        top &&
        entry.coalesceKey &&
        top.coalesceKey === entry.coalesceKey &&
        at - top.at <= coalesceMs
      ) {
        // Merge: first undo wins (restores the pre-burst state), latest redo
        // wins (re-applies the final state).
        top.redo = entry.redo;
        top.at = at;
      } else {
        undoStack.push({ ...entry, at });
        if (undoStack.length > maxDepth) {
          undoStack.splice(0, undoStack.length - maxDepth);
        }
      }
      redoStack.length = 0;
      notify();
    },

    async undo() {
      const entry = undoStack.pop();
      if (!entry) return false;
      redoStack.push(entry);
      notify();
      applying = true;
      try {
        await apply(entry.undo, "undo", entry);
      } finally {
        applying = false;
      }
      return true;
    },

    async redo() {
      const entry = redoStack.pop();
      if (!entry) return false;
      undoStack.push(entry);
      notify();
      applying = true;
      try {
        await apply(entry.redo, "redo", entry);
      } finally {
        applying = false;
      }
      return true;
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,

    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      notify();
    },

    peekUndoLabel: () => undoStack[undoStack.length - 1]?.label,
    peekRedoLabel: () => redoStack[redoStack.length - 1]?.label,
  };
}

export interface UseLocalOpUndoOptions<TOp>
  extends
    Omit<CreateLocalOpUndoOptions<TOp>, "onChange">,
    UndoKeyboardOptions {}

export interface UseLocalOpUndoResult<TOp> {
  push: (entry: LocalOpUndoEntry<TOp>) => void;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: boolean;
  canRedo: boolean;
  clear: () => void;
  controller: LocalOpUndoController<TOp>;
}

export function useLocalOpUndo<TOp>(
  options: UseLocalOpUndoOptions<TOp>,
): UseLocalOpUndoResult<TOp> {
  const [, setTick] = useState(0);
  const applyRef = useRef(options.apply);
  applyRef.current = options.apply;

  const controller = useMemo(
    () =>
      createLocalOpUndoController<TOp>({
        apply: (ops, direction, entry) =>
          applyRef.current(ops, direction, entry),
        maxDepth: options.maxDepth,
        coalesceMs: options.coalesceMs,
        now: options.now,
        onChange: () => setTick((n) => n + 1),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const undo = useCallback(() => controller.undo(), [controller]);
  const redo = useCallback(() => controller.redo(), [controller]);
  const push = useCallback(
    (entry: LocalOpUndoEntry<TOp>) => controller.push(entry),
    [controller],
  );
  const clear = useCallback(() => controller.clear(), [controller]);

  useUndoKeyboard(
    () => void controller.undo(),
    () => void controller.redo(),
    options,
  );

  return {
    push,
    undo,
    redo,
    canUndo: controller.canUndo(),
    canRedo: controller.canRedo(),
    clear,
    controller,
  };
}
