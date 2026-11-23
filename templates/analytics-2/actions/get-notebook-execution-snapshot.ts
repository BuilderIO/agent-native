import { defineAction } from "@agent-native/core/action";

import {
  snapshotInput,
  snapshotOutput,
  getExecutionSnapshot,
} from "../server/model/notebook-execution/readback.js";
import { currentResultActor } from "../server/model/notebook-results.js";

export default defineAction({
  description:
    "Read the accepted execution snapshot, current run and cells with execution output.",
  schema: snapshotInput,
  outputSchema: snapshotOutput,
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: async (input, context) =>
    getExecutionSnapshot(
      await currentResultActor(context?.caller ?? "unknown"),
      input.projectId,
    ),
});
