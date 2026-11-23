import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { usesBrowserNotebookKernel } from "../server/execution/kernel-client.js";
import {
  currentResultActor,
  loadNotebookResult,
  readNotebookKernelInput,
} from "../server/model/notebook-results.js";
import { resultIdSchema } from "../shared/notebook-execution.js";
import { completeResultManifestSchema } from "../shared/notebook-result-contract.js";

export default defineAction({
  description:
    "Read a complete, authorized draft SQL result for a browser Python session.",
  schema: z.strictObject({
    resultId: resultIdSchema,
    projectId: z.string().min(1),
  }),
  outputSchema: z
    .object({
      manifest: completeResultManifestSchema,
      arrow: z.string(),
    })
    .strict(),
  uiOnly: true,
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: async ({ resultId, projectId }, context) => {
    const actor = await currentResultActor(context?.caller ?? "unknown");
    const result = await loadNotebookResult(actor, resultId);
    if (
      !usesBrowserNotebookKernel() ||
      result.status !== "found" ||
      result.manifest.result.snapshot.projectId !== projectId
    )
      fail("The dataframe is unavailable.", {
        statusCode: 404,
        errorCode: "dataframe_denied",
      });
    const manifest = completeResultManifestSchema.safeParse(result.manifest);
    if (!manifest.success)
      fail("The dataframe is incomplete.", {
        statusCode: 409,
        errorCode: "dataframe_incomplete",
      });
    const arrow = await readNotebookKernelInput(actor, manifest.data);
    if (arrow.byteLength > 3 * 1024 * 1024)
      fail("The dataframe exceeds the browser transfer limit.", {
        statusCode: 413,
        errorCode: "quota_exceeded",
      });
    return {
      manifest: manifest.data,
      arrow: Buffer.from(arrow).toString("base64"),
    };
  },
});
