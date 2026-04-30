import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";
import { getAppBasePath } from "@agent-native/core/server";
import { defineEventHandler, getRequestURL } from "h3";
import { renderPublicForm } from "../lib/public-form-ssr.js";

const ssr = createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname;
  const basePath = getAppBasePath();
  const pathWithoutBase =
    basePath && pathname.startsWith(`${basePath}/`)
      ? pathname.slice(basePath.length)
      : pathname;
  if (pathWithoutBase.startsWith("/f/")) {
    return renderPublicForm(event);
  }
  return ssr(event);
});
