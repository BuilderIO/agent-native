import { defineAction } from "@agent-native/core/action";

import {
  currentResultActor,
  openPublishedResultDrill,
  openPublishedResultDrillInput,
  openPublishedResultDrillOutput,
} from "../server/model/notebook-results.js";

export default defineAction({
  description:
    "Read matching rows from a complete result visible in the specified published app session. Use field IDs from the result manifest.",
  schema: openPublishedResultDrillInput,
  outputSchema: openPublishedResultDrillOutput,
  mcpOutputSchema: true,
  readOnly: true,
  persistInBrowser: false,
  run: async (input, context) =>
    openPublishedResultDrill(
      await currentResultActor(context?.caller ?? "unknown"),
      input,
    ),
});
