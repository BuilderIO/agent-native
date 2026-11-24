import * as React from "react";

/**
 * Result returned by `useOptimisticAction().run`.
 */
export type OptimisticActionOutcome<TResult> =
  | { ok: true; result: TResult }
  | { ok: false; error: unknown; message: string };

/**
 * Configuration for `useOptimisticAction`.
 */
export interface UseOptimisticActionOptions<TInput, TSnapshot, TResult> {
  onMutate: (input: TInput) => TSnapshot;
  execute: (input: TInput) => Promise<TResult>;
  onRollback: (snapshot: TSnapshot, error: unknown, input: TInput) => void;
  onSuccess?: (result: TResult, input: TInput, snapshot: TSnapshot) => void;
  onError?: (message: string, error: unknown, input: TInput) => void;
  onUndo?: (snapshot: TSnapshot, input: TInput) => void | Promise<void>;
  errorFallbackMessage?: string;
}

/**
 * Return value of `useOptimisticAction`.
 */
export interface OptimisticActionController<TInput, TResult> {
  run: (input: TInput) => Promise<OptimisticActionOutcome<TResult>>;
  undo: () => Promise<boolean>;
  canUndo: boolean;
  isPending: boolean;
  error: string | null;
  reset: () => void;
}

function resolveActionError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
}

/**
 * Wraps an async mutation with synchronous optimistic snapshot capture,
 * automatic rollback + error callback on failure, and an optional undo hook.
 */
export function useOptimisticAction<TInput, TSnapshot, TResult = void>(
  options: UseOptimisticActionOptions<TInput, TSnapshot, TResult>,
): OptimisticActionController<TInput, TResult> {
  const optionsRef = React.useRef(options);
  React.useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [canUndo, setCanUndo] = React.useState(false);

  const inFlightCountRef = React.useRef(0);
  const lastUndoableRef = React.useRef<{
    snapshot: TSnapshot;
    input: TInput;
  } | null>(null);

  const reset = React.useCallback(() => {
    setError(null);
    setCanUndo(false);
    lastUndoableRef.current = null;
  }, []);

  const run = React.useCallback(
    async (input: TInput): Promise<OptimisticActionOutcome<TResult>> => {
      const current = optionsRef.current;
      const snapshot = current.onMutate(input);
      inFlightCountRef.current += 1;
      setIsPending(true);
      setError(null);

      try {
        const result = await current.execute(input);
        if (optionsRef.current.onUndo) {
          lastUndoableRef.current = { snapshot, input };
          setCanUndo(true);
        } else {
          lastUndoableRef.current = null;
          setCanUndo(false);
        }
        optionsRef.current.onSuccess?.(result, input, snapshot);
        return { ok: true, result };
      } catch (err: unknown) {
        const message = resolveActionError(
          err,
          optionsRef.current.errorFallbackMessage ??
            "Could not save changes. Your previous state has been restored.",
        );
        optionsRef.current.onRollback(snapshot, err, input);
        setError(message);
        optionsRef.current.onError?.(message, err, input);
        return { ok: false, error: err, message };
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
        if (inFlightCountRef.current === 0) {
          setIsPending(false);
        }
      }
    },
    [],
  );

  const undo = React.useCallback(async (): Promise<boolean> => {
    const entry = lastUndoableRef.current;
    const undoHandler = optionsRef.current.onUndo;
    if (!entry || !undoHandler) {
      return false;
    }
    lastUndoableRef.current = null;
    setCanUndo(false);
    inFlightCountRef.current += 1;
    setIsPending(true);
    setError(null);
    try {
      await undoHandler(entry.snapshot, entry.input);
      return true;
    } catch (err: unknown) {
      const message = resolveActionError(
        err,
        optionsRef.current.errorFallbackMessage ?? "Could not undo action.",
      );
      setError(message);
      optionsRef.current.onError?.(message, err, entry.input);
      return false;
    } finally {
      inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
      if (inFlightCountRef.current === 0) {
        setIsPending(false);
      }
    }
  }, []);

  return {
    run,
    undo,
    canUndo,
    isPending,
    error,
    reset,
  };
}
