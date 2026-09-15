import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

export interface ReconcileSaveBase {
  title?: string;
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
  getDraft,
  getTitle,
  getSaveIdentity = getDraft,
  stateRef,
}: {
  save: (content: string, base?: ReconcileSaveBase) => Promise<boolean>;
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
  const callbacks = useRef({ save, getDraft, getTitle, getSaveIdentity });
  callbacks.current = { save, getDraft, getTitle, getSaveIdentity };

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
          const draft = callbacks.current.getDraft();
          const persisted = await callbacks.current.save(draft, saveBase);
          if (generation.current !== started) return false;
          if (!persisted) {
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
        return false;
      } catch {
        if (generation.current === started) {
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
    [current, publish],
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
        if (!resolved || generation.current !== started) return false;
        const latest = current.current;
        if (
          !latest ||
          latest.localDraft !== snapshot.localDraft ||
          latest.localTitle !== snapshot.localTitle
        ) {
          return false;
        }
        publish(null);
        return true;
      } catch {
        if (generation.current === started) {
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
    [current, publish],
  );

  const release = useCallback(() => {
    generation.current += 1;
    publish(null);
  }, [publish]);

  return {
    state,
    report,
    updateDraft,
    resolve,
    resolveChoice,
    release,
    current,
  };
}
