import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  DEFAULT_LIBRARY_PRESETS,
  DEFAULT_LIBRARY_PRESET_VERSION,
} from "../shared/library-presets.js";

export default defineAction({
  description:
    "List built-in asset library style presets that can be used to create editable libraries.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => ({
    count: DEFAULT_LIBRARY_PRESETS.length,
    version: DEFAULT_LIBRARY_PRESET_VERSION,
    presets: DEFAULT_LIBRARY_PRESETS,
  }),
});
