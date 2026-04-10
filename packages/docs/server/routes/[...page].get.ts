import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";

export default createH3SSRHandler(
  // @ts-expect-error — virtual module provided by React Router Vite plugin
  () => import("virtual:react-router/server-build"),
);
