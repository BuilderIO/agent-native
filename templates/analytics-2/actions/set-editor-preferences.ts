import { defineAction } from "@agent-native/core/action";

import {
  editorPreferences,
  editorPreferencesPatch,
} from "../shared/editor-preferences.js";
import { updateEditorPreferences } from "./_editor-preferences.js";
export default defineAction({
  description: "Update the signed-in person's notebook editor preferences.",
  schema: editorPreferencesPatch,
  outputSchema: editorPreferences,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: updateEditorPreferences,
});
