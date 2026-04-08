import { createSSRRequestHandler } from "@agent-native/core/server/ssr-handler";
import { defineEventHandler, getRequestURL } from "h3";
import { renderPublicForm } from "../lib/public-form-ssr.js";

const renderSSR = createSSRRequestHandler();

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  if (url.pathname.startsWith("/f/")) {
    return renderPublicForm(event);
  }
  return renderSSR(event);
});
