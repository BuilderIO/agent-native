import { defineAction } from "@agent-native/core/action";

import {
  cellExecutionInput,
  cellExecutionOutput,
  getCellExecution,
} from "../server/model/notebook-execution/readback.js";
import { currentResultActor } from "../server/model/notebook-results.js";

export default defineAction({
  description:
    "Read the current cell attempt, ordered Python output and export references.",
  schema: cellExecutionInput,
  outputSchema: cellExecutionOutput,
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: async (input, context) =>
    getCellExecution(
      await currentResultActor(context?.caller ?? "unknown"),
      input,
    ),
});
