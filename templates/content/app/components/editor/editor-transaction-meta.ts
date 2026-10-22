// Marks a change to the document that isn't an edit to the page, so it isn't
// saved: the editor repairing a document it has just loaded, such as table
// headers, or a block storing interface state on its node, such as whether a
// video's source panel is open.
export const EDITOR_NON_EDIT_META = "contentEditorNonEdit";
