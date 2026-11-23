import { defineAction } from "@agent-native/core/action";

import { requestNotebookKernelStream } from "../server/model/kernel-access.js";
import {
  kernelStreamInputSchema,
  kernelStreamResultSchema,
} from "../server/model/kernel-namespaces.js";

export default defineAction({
  description: "Open an event stream for an authorized notebook run.",
  schema: kernelStreamInputSchema,
  outputSchema: kernelStreamResultSchema,
  http: { method: "POST" },
  requiresAuth: true,
  uiOnly: true,
  requiresSignedInBrowser: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  readOnly: true,
  persistInBrowser: false,
  persistInChatHistory: false,
  run: requestNotebookKernelStream,
});
