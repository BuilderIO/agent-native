import { RecoveryAttemptEnded } from "./recovery-attempt";

export function mayClearRecoveryDraft(
  draft: { title: string; content: string } | null,
  persisted: { title: string; content: string },
): boolean {
  return (
    draft !== null &&
    draft.title === persisted.title &&
    draft.content === persisted.content
  );
}

/**
 * Whether a later save by the same editor session already carries a recovery
 * draft it wrote when an earlier save did not land. Only those drafts qualify:
 * others (conflicts, displaced text) may hold text the editor no longer has.
 */
export function ownRecoveryDraftSupersededBySave(
  draft: {
    editorSessionId: string | null;
    editGeneration: number | null;
    supersedable?: boolean;
  },
  save: { editorSessionId: string; editGeneration: number },
): boolean {
  return (
    draft.supersedable === true &&
    draft.editorSessionId === save.editorSessionId &&
    draft.editGeneration !== null &&
    draft.editGeneration <= save.editGeneration
  );
}

export interface PageSaveResult {
  contentPersisted: boolean;
  outcome?:
    | "superseded"
    | "abandoned"
    | "pending_preservation"
    | "pending_collaboration_flush";
  recoveryDraft?: {
    title: string;
    baseTitle?: string | null;
    content: string;
    baseContent?: string;
    baseUpdatedAt?: string | null;
    baseRevision?: string;
  };
}

export class AbandonedPageSaveError extends Error {
  constructor() {
    super("The editor session is no longer active.");
    this.name = "AbandonedPageSaveError";
  }
}

/**
 * A save whose recovery step outlived the attempt that owned it: the editor
 * left, or its account, org or page changed. The save's own answer is
 * `result`; the recovery draft was neither kept nor cleared, so the page's
 * journal and its next open carry the text. Never a success to report.
 */
export class PageSaveHandedOff extends Error {
  constructor(readonly result: PageSaveResult) {
    super("The save's recovery outlived the editor that started it.");
    this.name = "PageSaveHandedOff";
  }
}

export async function runPageSaveIfSessionActive(
  isActive: () => boolean,
  save: () => Promise<PageSaveResult>,
): Promise<PageSaveResult> {
  if (!isActive()) return { contentPersisted: false, outcome: "abandoned" };
  return save();
}

export async function savePageWithRecovery({
  save,
  retain,
  clear,
}: {
  save: () => Promise<PageSaveResult>;
  retain: (reason: "conflict" | null, result?: PageSaveResult) => Promise<void>;
  clear: () => Promise<void>;
}): Promise<PageSaveResult> {
  let result: PageSaveResult;
  try {
    result = await save();
  } catch (error) {
    if (error instanceof AbandonedPageSaveError) {
      return { contentPersisted: false, outcome: "abandoned" };
    }
    try {
      await retain(null);
    } catch (retainError) {
      // An ended attempt keeps nothing, so the save's failure is still the one
      // to report.
      if (!(retainError instanceof RecoveryAttemptEnded)) throw retainError;
    }
    throw error;
  }

  try {
    if (!result.contentPersisted) {
      if (result.outcome === "superseded" || result.outcome === "abandoned")
        return result;
      await retain(result.recoveryDraft ? null : "conflict", result);
      return result;
    }

    await clear();
    return result;
  } catch (error) {
    if (error instanceof RecoveryAttemptEnded)
      throw new PageSaveHandedOff(result);
    throw error;
  }
}
