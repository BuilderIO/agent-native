import {
  defineEventHandler,
  readBody,
  type H3Event,
} from "h3";

export const logMessage = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  console.log("CLIENT LOG:", body);
  return { success: true };
});
