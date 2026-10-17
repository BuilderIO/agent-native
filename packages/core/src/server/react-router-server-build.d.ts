// React Router typegen writes an exact `declare module` for this name into
// `.react-router/types/+server-build.d.ts`. The trailing `*` makes this a
// pattern ambient module, which TypeScript uses only when no exact declaration
// exists, so the two never collide as duplicate exports.
declare module "virtual:react-router/server-build*" {
  import type { ServerBuild } from "react-router";
  const build: ServerBuild;
  export = build;
}
