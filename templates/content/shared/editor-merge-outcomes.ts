// How a merge of a newer saved body went: it kept every saved change (a body
// whose changes the tab had already made keeps them all), or set at least one
// aside for overlapping the tab's own edit.
export const EDITOR_MERGE_OUTCOMES = ["kept_all", "set_aside"] as const;
export type EditorMergeOutcome = (typeof EDITOR_MERGE_OUTCOMES)[number];

// Where the merge ran: in an open editor taking in a newer saved body, or in a
// save that met a newer body and was rebased over it before being written.
export const EDITOR_MERGE_PATHS = ["open_editor", "save_rebase"] as const;
export type EditorMergePath = (typeof EDITOR_MERGE_PATHS)[number];
