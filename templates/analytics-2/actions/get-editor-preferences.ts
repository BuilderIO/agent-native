import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { editorPreferences } from "../shared/editor-preferences.js";
import { readEditorPreferences } from "./_editor-preferences.js";
export default defineAction({
  description: "Read the signed-in person's notebook editor preferences.",
  schema: z.object({}),
  outputSchema: editorPreferences,
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: readEditorPreferences,
});
