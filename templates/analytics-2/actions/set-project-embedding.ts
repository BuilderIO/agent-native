import { defineAction } from "@agent-native/core/action";

import { setProjectEmbeddingSettings } from "../server/model/app-embedding.js";
import {
  setProjectEmbeddingInput,
  setProjectEmbeddingOutput,
} from "../shared/app-embedding.js";

export default defineAction({
  description:
    "Enable or disable signed embedding for a project and revoke active tokens when disabled.",
  schema: setProjectEmbeddingInput,
  outputSchema: setProjectEmbeddingOutput,
  http: { method: "POST" },
  persistInBrowser: false,
  run: async (input) => setProjectEmbeddingSettings(input),
});
