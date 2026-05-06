import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";
import { defineEventHandler, setResponseHeader } from "h3";
import {
  MEDIA_CAPTURE_PERMISSIONS_POLICY,
  withMediaCapturePermissions,
} from "../lib/media-permissions.js";

const ssrHandler = createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);

export default defineEventHandler(async (event) => {
  const response = (await ssrHandler(event)) as Response;
  setResponseHeader(
    event,
    "Permissions-Policy",
    MEDIA_CAPTURE_PERMISSIONS_POLICY,
  );
  return withMediaCapturePermissions(response);
});
