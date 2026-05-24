import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "@agent-native/core/vite";

export default defineConfig({
  // Workbench's reserved dev port. Matches `devPort: 8104` in
  // `packages/shared-app-config/templates.ts` and
  // `packages/core/src/cli/templates-meta.ts`. Without this explicit
  // setting, `agent-native dev` falls back to the framework default
  // (8080) which collides with the workspace gateway and the other
  // first-party apps that all default to 8080 too.
  port: 8104,
  plugins: [reactRouter()],
  // shiki only runs in AssistantChat's useEffect — keep it out of the
  // CF Pages Functions bundle (25 MiB limit).
  ssrStubs: ["shiki"],
});
