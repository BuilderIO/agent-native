// How an open editor's merge of a newer saved body went: it kept every saved
// change, or set at least one aside for overlapping the tab's own edit.
export const EDITOR_MERGE_OUTCOMES = ["kept_all", "set_aside"] as const;
export type EditorMergeOutcome = (typeof EDITOR_MERGE_OUTCOMES)[number];
