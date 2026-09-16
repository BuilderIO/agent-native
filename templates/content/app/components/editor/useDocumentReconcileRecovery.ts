import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

export interface ReconcileSaveBase {
  title: string;
  content: string;
  updatedAt: string | null;
  revision?: string;
}

export interface DocumentReconcileRecoveryState {
  reason: "conflict" | "failed" | "save-failed";
  localDraft: string;
  localTitle: string;
  saving: boolean;
}

export interface ReconcileRecoveryDraft {
  localDraft: string;
  localTitle: string;
}

export function useDocumentReconcileRecovery({
  save,
  retain,
  getDraft,
  getTitle,
  getSaveIdentity = getDraft,
  stateRef,
}: {
  save: (
    draft: ReconcileRecoveryDraft,
    base?: ReconcileSaveBase,
  ) => Promise<boolean>;
  retain?: (draft: ReconcileRecoveryDraft) => Promise<void>;
  getDraft: () => string;
  getTitle?: () => string;
  getSaveIdentity?: () => string;
  stateRef?: MutableRefObject<DocumentReconcileRecoveryState | null>;
}) {
  const [state, setState] = useState<DocumentReconcileRecoveryState | null>(
    null,
  );
  const internalStateRef = useRef(state);
  const current = stateRef ?? internalStateRef;
  const generation = useRef(0);
  const inFlight = useRef(false);
  const callbacks = useRef({
    save,
    retain,
    getDraft,
    getTitle,
    getSaveIdentity,
  });
  callbacks.current = { save, retain, getDraft, getTitle, getSaveIdentity };

  const latestDraft = useCallback(
    (): ReconcileRecoveryDraft => ({
      localDraft: callbacks.current.getDraft(),
      localTitle: callbacks.current.getTitle?.() ?? "",
    }),
    [],
  );

  const retainLatest = useCallback(async () => {
    if (callbacks.current.retain) await callbacks.current.retain(latestDraft());
  }, [latestDraft]);

  useEffect(
    () => () => {
      generation.current += 1;
      current.current = null;
    },
    [],
  );

  const publish = useCallback(
    (next: DocumentReconcileRecoveryState | null) => {
      current.current = next;
      setState(next);
    },
    [current],
  );

  const report = useCallback(
    (reason: "conflict" | "failed", localDraft: string) => {
      generation.current += 1;
      publish({
        reason,
        localDraft,
        localTitle: callbacks.current.getTitle?.() ?? "",
        saving: inFlight.current,
      });
    },
    [publish],
  );

  const updateDraft = useCallback(
    (localDraft: string, localTitle = callbacks.current.getTitle?.() ?? "") => {
      if (!current.current) return false;
      publish({ ...current.current, localDraft, localTitle });
      return true;
    },
    [current, publish],
  );

  const reportRetentionFailure = useCallback(() => {
    const latest = current.current;
    if (!latest) return;
    publish({ ...latest, reason: "save-failed", saving: false });
  }, [current, publish]);

  const resolve = useCallback(
    async (base: ReconcileSaveBase): Promise<boolean> => {
      if (!current.current || inFlight.current) return false;
      inFlight.current = true;
      const started = generation.current;
      publish({ ...current.current, saving: true });
      let saveBase: ReconcileSaveBase | undefined = base;
      try {
        while (generation.current === started) {
          const identity = callbacks.current.getSaveIdentity();
          const draft = latestDraft();
          const persisted = await callbacks.current.save(draft, saveBase);
          if (generation.current !== started) {
            await retainLatest();
            return false;
          }
          if (!persisted) {
            await retainLatest();
            publish({
              reason: "conflict",
              localDraft: callbacks.current.getDraft(),
              localTitle: callbacks.current.getTitle?.() ?? "",
              saving: false,
            });
            return false;
          }
          if (callbacks.current.getSaveIdentity() === identity) {
            publish(null);
            return true;
          }
          saveBase = undefined;
        }
        await retainLatest();
        return false;
      } catch {
        if (generation.current === started) {
          try {
            await retainLatest();
          } catch {
            // The visible recovery state remains the final fallback.
          }
          publish({
            reason: "save-failed",
            localDraft: callbacks.current.getDraft(),
            localTitle: callbacks.current.getTitle?.() ?? "",
            saving: false,
          });
        }
        return false;
      } finally {
        inFlight.current = false;
        if (current.current?.saving)
          publish({ ...current.current, saving: false });
      }
    },
    [current, latestDraft, publish, retainLatest],
  );

  const resolveChoice = useCallback(
    async (
      base: ReconcileSaveBase,
      action: (
        draft: ReconcileRecoveryDraft,
        base: ReconcileSaveBase,
      ) => Promise<boolean>,
    ): Promise<boolean> => {
      const snapshot = current.current;
      if (!snapshot || inFlight.current) return false;
      inFlight.current = true;
      const started = generation.current;
      publish({ ...snapshot, saving: true });
      try {
        const resolved = await action(
          {
            localDraft: snapshot.localDraft,
            localTitle: snapshot.localTitle,
          },
          base,
        );
        if (!resolved || generation.current !== started) {
          await retainLatest();
          return false;
        }
        const latest = current.current;
        if (
          !latest ||
          latest.localDraft !== snapshot.localDraft ||
          latest.localTitle !== snapshot.localTitle
        ) {
          await retainLatest();
          return false;
        }
        publish(null);
        return true;
      } catch {
        if (generation.current === started) {
          try {
            await retainLatest();
          } catch {
            // The visible recovery state remains the final fallback.
          }
          const latest = current.current;
          if (latest)
            publish({ ...latest, reason: "save-failed", saving: false });
        }
        return false;
      } finally {
        inFlight.current = false;
        if (current.current?.saving)
          publish({ ...current.current, saving: false });
      }
    },
    [current, publish, retainLatest],
  );

  const release = useCallback(() => {
    generation.current += 1;
    publish(null);
  }, [publish]);

  return {
    state,
    report,
    updateDraft,
    reportRetentionFailure,
    resolve,
    resolveChoice,
    release,
    current,
  };
}
