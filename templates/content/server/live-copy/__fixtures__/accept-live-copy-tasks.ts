import { defineLiveCopyTasks } from "@agent-native/core/collab/live-copy-tasks";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { materializeLiveBody } from "../../../shared/live-body.js";
import { nfmToDoc } from "../../../shared/nfm.js";
import { suggestionEditorSchema } from "../../../shared/suggestion-apply.js";
import {
  APPLY_SUGGESTION_EDIT,
  applySuggestionEdit,
  type ApplySuggestionInput,
} from "../apply-suggestion-edit.js";

// The live-copy tasks accept's tests run: a Page body as Markdown, and the
// apply-suggestion edit.

export const tasks = defineLiveCopyTasks({
  derive(doc) {
    // Reading the tree deletes what the schema rejects; derive must not edit.
    const copy = new Y.Doc();
    try {
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
      const live = materializeLiveBody(copy);
      return live.kind === "body"
        ? live.markdown
        : { kind: "refused", reason: live.kind };
    } finally {
      copy.destroy();
    }
  },
  seed(doc, field, source) {
    prosemirrorJSONToYXmlFragment(
      suggestionEditorSchema(),
      nfmToDoc(source),
      doc.getXmlFragment(field),
    );
  },
  edits: {
    [APPLY_SUGGESTION_EDIT]: (doc, field, input) =>
      applySuggestionEdit(doc, field, input as ApplySuggestionInput),
  },
});
