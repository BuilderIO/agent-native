import { registerPrivateBlobProvider } from "@agent-native/core/private-blob";
import { registerRecurringSweepHandler } from "@agent-native/core/server";

import { localNotebookBlobProvider } from "../execution/local-notebook-blob.js";

export default function registerNotebookExecution() {
  registerPrivateBlobProvider(localNotebookBlobProvider());
  registerRecurringSweepHandler(
    "analytics2-notebook-execution",
    async (context) => {
      const { sweepNotebookRuns } =
        await import("../model/notebook-execution/service.js");
      await sweepNotebookRuns(context);
    },
  );
  registerRecurringSweepHandler(
    "analytics2-notebook-result-staging",
    async (context) => {
      const { sweepNotebookResultStaging } =
        await import("../model/notebook-results.js");
      await sweepNotebookResultStaging(context);
    },
  );
}
