import { createSSRRequestHandler } from "@agent-native/core/server";
import { defineEventHandler } from "h3";
import { renderPublicForm } from "../lib/public-form-ssr.js";

const renderSSR = createSSRRequestHandler();

export default defineEventHandler(async (event) => {
  if (event.url.pathname.startsWith("/f/")) {
    return renderPublicForm(event);
  }
  return renderSSR(event);
});
