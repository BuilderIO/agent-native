import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";
import { defineEventHandler, getRequestURL } from "h3";
import { renderPublicForm } from "../lib/public-form-ssr.js";

const ssr = createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);

export default defineEventHandler(async (event) => {
  if (getRequestURL(event).pathname.startsWith("/f/")) {
    return renderPublicForm(event);
  }
  return ssr(event);
});
