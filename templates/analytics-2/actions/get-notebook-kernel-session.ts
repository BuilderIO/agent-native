import { defineAction } from "@agent-native/core/action";

import {
  kernelSessionInput,
  kernelSessionOutput,
  getKernelSession,
} from "../server/model/notebook-execution/readback.js";
import { currentResultActor } from "../server/model/notebook-results.js";

export default defineAction({
  description:
    "Read the current draft kernel generation and scoped live variables.",
  schema: kernelSessionInput,
  outputSchema: kernelSessionOutput,
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: async (input, context) =>
    getKernelSession(
      await currentResultActor(context?.caller ?? "unknown"),
      input.scope.projectId,
    ),
});
