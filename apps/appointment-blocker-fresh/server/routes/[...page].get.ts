import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";

export default createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);
