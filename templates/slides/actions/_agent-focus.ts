import { getRequestRunContext } from "@agent-native/core/server/request-context";

import {
  selectionItemKey,
  slidesAgentFocusSchema,
  type SlidesAgentFocus,
} from "../shared/agent-focus.js";
import { readAppStateForCurrentTab } from "./_tab-state.js";

export type TurnSlidesFocus =
  | { status: "none" }
  | { status: "unreadable" }
  | { status: "sent"; deckId: string; focus: SlidesAgentFocus };

/** What the user had open in the scoped deck when they sent this turn's message. */
export function readTurnSlidesFocus(): TurnSlidesFocus {
  const scope = getRequestRunContext()?.chatScope;
  if (scope?.type !== "deck" || scope.focus === undefined) {
    return { status: "none" };
  }
  const parsed = slidesAgentFocusSchema.safeParse(scope.focus);
  if (!parsed.success) {
    console.warn(
      "[slides] chat scope focus is unreadable; using the live screen:",
      parsed.error.message,
    );
    return { status: "unreadable" };
  }
  return { status: "sent", deckId: scope.id, focus: parsed.data };
}

/** Once the agent navigates within the scoped deck, the rest of the turn follows it. */
export function moveTurnSlidesFocus(deckId: string, slideNumber: number): void {
  const run = getRequestRunContext();
  if (run?.chatScope?.type !== "deck" || run.chatScope.id !== deckId) return;
  const focus: SlidesAgentFocus = { slideNumber, items: [] };
  run.chatScope = { ...run.chatScope, focus };
}

export interface TurnSlidesSelection {
  selection: Record<string, unknown> | null;
  /** The user changed their selection after sending, so only the sent element identities remain. */
  fromSentFocus: boolean;
}

/**
 * The live selection still describes the sent targets until the user changes
 * it; after that, only the identities sent with the message are trustworthy.
 */
export async function readTurnSlidesSelection(
  deckId: string,
): Promise<TurnSlidesSelection> {
  const live = await readAppStateForCurrentTab("slides-selection", {
    fallbackToGlobal: false,
  });
  const turn = readTurnSlidesFocus();
  if (turn.status !== "sent" || turn.deckId !== deckId) {
    return { selection: live, fromSentFocus: false };
  }
  const { slideId, items } = turn.focus;
  if (!slideId) return { selection: null, fromSentFocus: false };
  const liveItems = Array.isArray(live?.items) ? live.items : [];
  const liveMatches =
    live !== null &&
    (live.deckId === undefined || live.deckId === deckId) &&
    live.slideId === slideId &&
    JSON.stringify(liveItems.map(selectionItemKey)) ===
      JSON.stringify(items.map(selectionItemKey));
  if (liveMatches) return { selection: live, fromSentFocus: false };
  return { selection: { deckId, slideId, items }, fromSentFocus: true };
}
