import { defineAction } from "@agent-native/core/action";

import { findPublishedAppColleagues } from "../server/model/published-app-access.js";
import {
  findPublishedAppColleaguesInput,
  findPublishedAppColleaguesOutput,
} from "../shared/project-sharing.js";

export default defineAction({
  description:
    "Find existing active workspace members eligible for access to a published app.",
  schema: findPublishedAppColleaguesInput,
  outputSchema: findPublishedAppColleaguesOutput,
  outputErrorStrategy: "strict",
  mcpOutputSchema: true,
  persistInBrowser: false,
  readOnly: true,
  http: { method: "GET" },
  run: findPublishedAppColleagues,
});
