import { defineEventHandler } from "h3";
import { DemoResponse } from "@shared/api";

export const handleDemo = defineEventHandler((_event) => {
  const response: DemoResponse = {
    message: "Hello from H3 server",
  };
  return response;
});
