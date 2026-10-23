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
 * A save that outlived the attempt that owned it: the editor left, or its
 * account, org or page changed. What the server answered goes with it: the
 * request's answer when the owner ended inside the save, or null when no
 * request had gone out, and the save's result when only its recovery step was
 * left. Nothing after that ran, so the recovery draft was neither kept nor
 * cleared and the page's journal and its next open carry the text. Never a
 * success to report; a request that failed is reported as itself instead.
 */
export class PageSaveHandedOff extends Error {
  constructor(
    readonly handoff:
      | { during: "save"; answer: PromiseFulfilledResult<unknown> | null }
      | { during: "recovery"; result: PageSaveResult },
  ) {
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
    if (error instanceof RecoveryAttemptEnded) {
      if (error.answer?.status === "rejected") throw error.answer.reason;
      throw new PageSaveHandedOff({ during: "save", answer: error.answer });
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
      throw new PageSaveHandedOff({ during: "recovery", result });
    throw error;
  }
}
