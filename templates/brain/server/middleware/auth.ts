import { runAuthGuard } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  return runAuthGuard(event);
});
