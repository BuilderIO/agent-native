import { runAuthGuard } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

import { answerContentChunkPreflight } from "../lib/content-clip-uploads.js";

export default defineEventHandler(async (event) => {
  return answerContentChunkPreflight(event) ?? runAuthGuard(event);
});
