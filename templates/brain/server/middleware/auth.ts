import { defineEventHandler } from "h3";
import { runAuthGuard } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  return runAuthGuard(event);
});
