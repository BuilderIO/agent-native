import type { ComposeState } from "@shared/types";

export function shouldMarkReplyDoneAfterSend(
  draft: Pick<ComposeState, "mode" | "replyToId">,
  sendAndArchive: boolean,
  explicitlyMarkDone: boolean,
): boolean {
  return (
    draft.mode === "reply" &&
    Boolean(draft.replyToId) &&
    (sendAndArchive || explicitlyMarkDone)
  );
}
