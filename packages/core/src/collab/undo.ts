import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

export interface UndoKeyboardOptions {
  enableKeyboardShortcuts?: boolean;
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

export type CollabUndoScope =
  | Y.AbstractType<any>
  | Y.AbstractType<any>[]
  | ((doc: Y.Doc) => Y.AbstractType<any> | Y.AbstractType<any>[]);

export interface UseCollabUndoOptions extends UndoKeyboardOptions {
  ydoc: Y.Doc | null | undefined;
  scope: CollabUndoScope;
  trackedOrigins?: unknown[];
  captureTimeout?: number;
}

export interface UseCollabUndoResult {
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  localOrigin: unknown;
  transactLocal: <T>(fn: () => T) => T;
  undoManager: Y.UndoManager | null;
}

export function useCollabUndo(
  options: UseCollabUndoOptions,
): UseCollabUndoResult {
  const { ydoc, scope, trackedOrigins, captureTimeout = 500 } = options;

  const localOrigin = useMemo<unknown>(
    () => ({ collabUndoLocalOrigin: true }),
    [],
  );

  const managerRef = useRef<Y.UndoManager | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

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

export interface LocalOpUndoEntry<TOp> {
  undo: TOp[];
  redo: TOp[];
  label?: string;
  coalesceKey?: string;
  coalesceWindowMs?: number;
}

export interface LocalOpUndoController<TOp> {
  push(entry: LocalOpUndoEntry<TOp>): void;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  peekUndoLabel(): string | undefined;
  peekRedoLabel(): string | undefined;
}

export interface CreateLocalOpUndoOptions<TOp> {
  apply: (
    ops: TOp[],
    direction: "undo" | "redo",
    entry: LocalOpUndoEntry<TOp>,
  ) => void | Promise<void>;
  maxDepth?: number;
  coalesceMs?: number;
  onChange?: () => void;
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
      if (applying) return;

      const at = now();
      const top = undoStack[undoStack.length - 1];
      const coalesceWindowMs = entry.coalesceWindowMs ?? coalesceMs;
      if (
        top &&
        entry.coalesceKey &&
        top.coalesceKey === entry.coalesceKey &&
        at - top.at <= coalesceWindowMs
      ) {
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
