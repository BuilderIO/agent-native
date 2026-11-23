import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  getNotebookInputChoices,
  getNotebookInputChoicesOutput,
} from "../server/model/notebook-execution/input-choices.js";
import { currentExecutionActor } from "../server/model/notebook-execution/service.js";

export default defineAction({
  description:
    "Read the authorized current choices for a notebook input that uses a result column.",
  schema: z.strictObject({
    projectId: z.string().min(1),
    cellId: z.string().min(1),
  }),
  outputSchema: getNotebookInputChoicesOutput,
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: async ({ projectId, cellId }, context) =>
    getNotebookInputChoices(
      await currentExecutionActor(context?.caller ?? "unknown"),
      projectId,
      cellId,
    ),
});
