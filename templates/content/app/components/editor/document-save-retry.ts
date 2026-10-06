import type { PageSaveResult } from "./pageSession";

export function authoredCandidateMatchesContent(
  content: string,
  authoredCandidateContent: string | undefined,
): boolean {
  return (
    authoredCandidateContent !== undefined &&
    content === authoredCandidateContent
  );
}

type SaveSnapshot = {
  title: string;
  content: string;
  contentBase: {
    content: string;
    updatedAt: string | null;
    revision?: string;
  };
  titleBase: string;
  contentObservationEpoch: number;
};

type SaveOwner = {
  contentEditVersion: number;
  editGeneration: number;
  contentObservationEpoch: number;
};

export function pendingSaveRetrySnapshot(
  result: PageSaveResult,
  pending: SaveOwner,
  current: SaveOwner & SaveSnapshot & { canEdit: boolean },
): SaveSnapshot | null {
  if (
    result.contentPersisted ||
    result.outcome === "pending_preservation" ||
    !current.canEdit ||
    current.contentEditVersion !== pending.contentEditVersion ||
    current.editGeneration !== pending.editGeneration ||
    (result.outcome !== "superseded" && !result.recoveryDraft)
  ) {
    return null;
  }

  if (current.contentObservationEpoch !== pending.contentObservationEpoch) {
    return {
      title: current.title,
      content: current.content,
      contentBase: current.contentBase,
      titleBase: current.titleBase,
      contentObservationEpoch: current.contentObservationEpoch,
    };
  }

  const recovery = result.recoveryDraft;
  if (!recovery) return null;
  return {
    title: recovery.title,
    content: recovery.content,
    contentBase:
      recovery.baseContent === undefined
        ? current.contentBase
        : {
            content: recovery.baseContent,
            updatedAt: recovery.baseUpdatedAt ?? null,
            revision: recovery.baseRevision,
          },
    titleBase: current.titleBase,
    contentObservationEpoch: current.contentObservationEpoch,
  };
}
