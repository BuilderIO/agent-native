import {
  tryCallActionKeepalive,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import type { FormDetail } from "@shared/form-contract";
import type { Block } from "@shared/form-model";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";

import { withFormTitle } from "./editor-ops";

export type SaveState = "idle" | "saving" | "failed";

const SAVE_DELAY_MS = 3000;
const MAX_RETRY_MS = 30_000;

export function useEditorDocument(form: FormDetail) {
  const [blocks, setBlocks] = useState<Block[]>(() =>
    withFormTitle(form.draftBlocks ?? form.publishedBlocks),
  );
  const [edited, setEdited] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const save = useActionMutation("save-form-draft");
  const saveRef = useRef(save.mutateAsync);
  saveRef.current = save.mutateAsync;

  const latest = useRef(blocks);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);
  const lastClientTime = useRef(0);
  const failures = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const formId = form.id;

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** Resolves true once everything pending is saved, false if the save failed. */
  const flush = useCallback((): Promise<boolean> => {
    cancel();
    if (!dirty.current) return inFlight.current ?? Promise.resolve(true);
    dirty.current = false;
    const mine = ++sequence.current;
    lastClientTime.current = Math.max(Date.now(), lastClientTime.current + 1);
    setSaveState("saving");
    const saving = saveRef
      .current({
        id: formId,
        blocks: latest.current,
        clientTime: lastClientTime.current,
      })
      .then(() => {
        failures.current = 0;
        if (mine === sequence.current) setSaveState("idle");
        return true;
      })
      .catch(() => {
        if (mine !== sequence.current) return false;
        dirty.current = true;
        failures.current += 1;
        setSaveState("failed");
        cancel();
        timer.current = setTimeout(
          () => void flush(),
          Math.min(MAX_RETRY_MS, SAVE_DELAY_MS * 2 ** failures.current),
        );
        return false;
      })
      .finally(() => {
        if (inFlight.current === saving) inFlight.current = null;
      });
    inFlight.current = saving;
    return saving;
  }, [cancel, formId]);

  // The page is going away: a keepalive request outlives it. The clientTime is
  // the save's identity, so a copy that also lands normally is dropped as stale.
  const flushOnLeave = useCallback(() => {
    if (!dirty.current) return;
    cancel();
    const clientTime = Math.max(Date.now(), lastClientTime.current + 1);
    const sent = tryCallActionKeepalive("save-form-draft", {
      id: formId,
      blocks: latest.current,
      clientTime,
    });
    if (!sent.accepted) return void flush();
    lastClientTime.current = clientTime;
    dirty.current = false;
    sent.completion.catch(() => {
      dirty.current = true;
    });
  }, [cancel, flush, formId]);

  const blocker = useBlocker(() => dirty.current || inFlight.current !== null);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void flush().then((saved) => (saved ? blocker.proceed() : blocker.reset()));
  }, [blocker, flush]);

  const update = useCallback(
    (change: (blocks: Block[]) => Block[]) => {
      const next = change(latest.current);
      if (next === latest.current) return;
      latest.current = next;
      dirty.current = true;
      setBlocks(next);
      setEdited(true);
      cancel();
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [cancel, flush],
  );

  const markClean = useCallback(() => {
    cancel();
    dirty.current = false;
    setEdited(false);
  }, [cancel]);

  const reset = useCallback(
    (next: Block[]) => {
      cancel();
      dirty.current = false;
      latest.current = withFormTitle(next);
      setBlocks(latest.current);
      setEdited(false);
      setSaveState("idle");
    },
    [cancel],
  );

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushOnLeave();
    };
    const onBlur = () => void flush();
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", flushOnLeave);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", flushOnLeave);
      document.removeEventListener("visibilitychange", onHidden);
      void flush();
    };
  }, [flush, flushOnLeave]);

  return {
    blocks,
    latest,
    update,
    reset,
    markClean,
    flush,
    cancel,
    saveState,
    edited,
    hasChanges: form.status === "published" && (edited || form.hasDraftBlocks),
  };
}
