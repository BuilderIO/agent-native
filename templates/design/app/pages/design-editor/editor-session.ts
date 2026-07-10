import { generateTabId } from "@agent-native/core/client";

/** Stable for the lifetime of this module, including editor component refreshes. */
export const TAB_ID = generateTabId();

/**
 * Persistence revisions live on a DesignEditor component instance. Give that
 * instance its own operation source too: reusing module-stable TAB_ID after an
 * editor remount would pair reset revision counters with the server's old
 * high-watermark and make fresh saves look stale.
 */
export function createEditorSaveOperationSource(
  tabId = TAB_ID,
  editorInstanceId = generateTabId(),
): string {
  return `${tabId}:save:${editorInstanceId}`;
}

/** Yjs origin tracked by the local undo manager. */
export const LOCAL_EDIT_ORIGIN = `${TAB_ID}:local`;

/**
 * Agent-authored design replacements are remote Yjs transactions (or, when
 * the Yjs update is missed entirely — backgrounded tab, no live collab
 * session — a plain polled DB content refresh), but from the user's
 * perspective they are one undoable editor operation (for example, "change
 * this attached design"). Human peer edits remain outside the local undo
 * stack. The Yjs `ytext.observe` handler uses this predicate when an active
 * collaboration session identifies the remote transaction as agent-authored.
 * The authoritative DB reconcile fallback cannot reliably distinguish an
 * agent write from a human peer write when that live signal was missed, so it
 * records any genuinely newer external replacement separately. Both paths
 * preserve a before/after checkpoint for Cmd+Z.
 */
export function shouldCheckpointAgentContent(args: {
  agentActive: boolean;
  isLocalEdit: boolean;
  previousContent: string | null | undefined;
  nextContent: string;
}): args is {
  agentActive: true;
  isLocalEdit: false;
  previousContent: string;
  nextContent: string;
} {
  return Boolean(
    args.agentActive &&
    !args.isLocalEdit &&
    typeof args.previousContent === "string" &&
    args.previousContent !== args.nextContent,
  );
}

/**
 * TIE-BREAK: decides whether polled DB content should be adopted into the
 * live editor during the file-content reconcile effect (DesignEditor.tsx).
 * Callers only reach this decision once BOTH of the effect's own
 * "already reflecting this exact content" early-returns have already ruled
 * out `dbContent` matching what's currently rendered — so every call here
 * represents a genuine content difference.
 *
 * A strict `dbUpdatedAt > applied` used to be the only "is this newer"
 * check, which silently DROPPED a real external write whenever it landed in
 * the same millisecond as the previously-applied one (timestamp
 * resolution) — the tie was never treated as "newer," so the second write's
 * content just never rendered. That's only safe to fix by treating a tie as
 * adoptable while `agentActive` is false: when the agent IS active, a tied
 * timestamp with different content is more likely a live self-echo race
 * (the agent's own Yjs-tracked edit still mid-flight), which the caller's
 * `staleAgentEchoPossible` debounced recovery timer already handles
 * separately and more carefully — forcing immediate adoption for that case
 * too would skip the debounce and reintroduce the exact race it exists to
 * prevent.
 */
export function shouldAdoptExternalReconcileContent(args: {
  appliedUpdatedAt: string | null | undefined;
  dbUpdatedAt: string | null | undefined;
  agentActive: boolean;
}): boolean {
  const { appliedUpdatedAt, dbUpdatedAt, agentActive } = args;
  if (!appliedUpdatedAt) return true;
  if (!dbUpdatedAt) return false;
  if (dbUpdatedAt > appliedUpdatedAt) return true;
  return dbUpdatedAt === appliedUpdatedAt && !agentActive;
}
