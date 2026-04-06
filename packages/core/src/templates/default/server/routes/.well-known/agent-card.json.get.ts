import { defineEventHandler } from "h3";
import { handleFrameworkRequest } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  return handleFrameworkRequest(event);
});
