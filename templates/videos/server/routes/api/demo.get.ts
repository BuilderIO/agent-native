import { defineEventHandler, setResponseStatus, type H3Event } from "h3";
import { DemoResponse } from "@shared/api";

export default defineEventHandler((event: H3Event) => {
  setResponseStatus(event, 200);
  const response: DemoResponse = {
    message: "Hello from Express server",
  };
  return response;
});
