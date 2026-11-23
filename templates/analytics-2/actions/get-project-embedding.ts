import { defineAction } from "@agent-native/core/action";

import { getProjectEmbeddingSettings } from "../server/model/app-embedding.js";
import {
  getProjectEmbeddingInput,
  projectEmbeddingSettingsSchema,
} from "../shared/app-embedding.js";

export default defineAction({
  description:
    "Read app embedding and signed embedding settings for a project.",
  schema: getProjectEmbeddingInput,
  outputSchema: projectEmbeddingSettingsSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async (input) => getProjectEmbeddingSettings(input),
});
