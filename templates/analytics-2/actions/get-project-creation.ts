import { defineAction } from "@agent-native/core/action";

import {
  checkedProjectCreation,
  requireProjectCreationAccess,
} from "../server/lib/project-creation-access.js";
import { getProjectCreation } from "../server/model/notebook-creation/store.js";
import {
  creationRequestSchema,
  projectCreationSchema,
} from "../shared/notebook-creation.js";

export default defineAction({
  description: "Recover the original project creation receipt by request ID.",
  schema: creationRequestSchema,
  outputSchema: projectCreationSchema,
  outputErrorStrategy: "strict",
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: ({ requestId }) =>
    checkedProjectCreation(async () =>
      getProjectCreation({
        ...(await requireProjectCreationAccess()),
        requestId,
      }),
    ),
});
