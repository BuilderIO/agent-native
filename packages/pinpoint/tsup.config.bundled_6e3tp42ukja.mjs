// tsup.config.ts
import { defineConfig } from "tsup";
import { solidPlugin } from "esbuild-plugin-solid";
var tsup_config_default = defineConfig([
  // Browser bundle (includes SolidJS UI — react entry needs solidPlugin too)
  {
    entry: {
      "index.browser": "src/index.browser.ts",
      react: "src/react.tsx",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["react", "react-dom", "express", "@modelcontextprotocol/sdk"],
    noExternal: ["solid-js"],
    esbuildPlugins: [solidPlugin({ solid: { generate: "dom" } })],
    esbuildOptions(options) {
      options.conditions = ["browser", "solid", "import", "module"];
    },
    banner: { js: '"use client";' },
  },
  // Node/server bundle (no SolidJS UI)
  {
    entry: {
      index: "src/index.ts",
      "server/index": "src/server/index.ts",
      "primitives/index": "src/primitives/index.ts",
      "types/index": "src/types/index.ts",
      cli: "src/cli.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    external: [
      "react",
      "react-dom",
      "express",
      "solid-js",
      "solid-js/web",
      "@modelcontextprotocol/sdk",
      "@agent-native/core",
      "@medv/finder",
      "bippy",
      "element-source",
      "zod",
    ],
  },
]);
export { tsup_config_default as default };
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidHN1cC5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9faW5qZWN0ZWRfZmlsZW5hbWVfXyA9IFwiL3Jvb3QvYXBwL2NvZGUvcGFja2FnZXMvcGlucG9pbnQvdHN1cC5jb25maWcudHNcIjtjb25zdCBfX2luamVjdGVkX2Rpcm5hbWVfXyA9IFwiL3Jvb3QvYXBwL2NvZGUvcGFja2FnZXMvcGlucG9pbnRcIjtjb25zdCBfX2luamVjdGVkX2ltcG9ydF9tZXRhX3VybF9fID0gXCJmaWxlOi8vL3Jvb3QvYXBwL2NvZGUvcGFja2FnZXMvcGlucG9pbnQvdHN1cC5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidHN1cFwiO1xuaW1wb3J0IHsgc29saWRQbHVnaW4gfSBmcm9tIFwiZXNidWlsZC1wbHVnaW4tc29saWRcIjtcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKFtcbiAgLy8gQnJvd3NlciBidW5kbGUgKGluY2x1ZGVzIFNvbGlkSlMgVUkgXHUyMDE0IHJlYWN0IGVudHJ5IG5lZWRzIHNvbGlkUGx1Z2luIHRvbylcbiAge1xuICAgIGVudHJ5OiB7XG4gICAgICBcImluZGV4LmJyb3dzZXJcIjogXCJzcmMvaW5kZXguYnJvd3Nlci50c1wiLFxuICAgICAgcmVhY3Q6IFwic3JjL3JlYWN0LnRzeFwiLFxuICAgIH0sXG4gICAgZm9ybWF0OiBbXCJlc21cIl0sXG4gICAgZHRzOiB0cnVlLFxuICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICBjbGVhbjogdHJ1ZSxcbiAgICBleHRlcm5hbDogW1wicmVhY3RcIiwgXCJyZWFjdC1kb21cIiwgXCJleHByZXNzXCIsIFwiQG1vZGVsY29udGV4dHByb3RvY29sL3Nka1wiXSxcbiAgICBub0V4dGVybmFsOiBbXCJzb2xpZC1qc1wiXSxcbiAgICBlc2J1aWxkUGx1Z2luczogW3NvbGlkUGx1Z2luKHsgc29saWQ6IHsgZ2VuZXJhdGU6IFwiZG9tXCIgfSB9KV0sXG4gICAgZXNidWlsZE9wdGlvbnMob3B0aW9ucykge1xuICAgICAgb3B0aW9ucy5jb25kaXRpb25zID0gW1wiYnJvd3NlclwiLCBcInNvbGlkXCIsIFwiaW1wb3J0XCIsIFwibW9kdWxlXCJdO1xuICAgIH0sXG4gICAgYmFubmVyOiB7IGpzOiAnXCJ1c2UgY2xpZW50XCI7JyB9LFxuICB9LFxuICAvLyBOb2RlL3NlcnZlciBidW5kbGUgKG5vIFNvbGlkSlMgVUkpXG4gIHtcbiAgICBlbnRyeToge1xuICAgICAgaW5kZXg6IFwic3JjL2luZGV4LnRzXCIsXG4gICAgICBcInNlcnZlci9pbmRleFwiOiBcInNyYy9zZXJ2ZXIvaW5kZXgudHNcIixcbiAgICAgIFwicHJpbWl0aXZlcy9pbmRleFwiOiBcInNyYy9wcmltaXRpdmVzL2luZGV4LnRzXCIsXG4gICAgICBcInR5cGVzL2luZGV4XCI6IFwic3JjL3R5cGVzL2luZGV4LnRzXCIsXG4gICAgICBjbGk6IFwic3JjL2NsaS50c1wiLFxuICAgIH0sXG4gICAgZm9ybWF0OiBbXCJlc21cIl0sXG4gICAgZHRzOiB0cnVlLFxuICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICBleHRlcm5hbDogW1xuICAgICAgXCJyZWFjdFwiLFxuICAgICAgXCJyZWFjdC1kb21cIixcbiAgICAgIFwiZXhwcmVzc1wiLFxuICAgICAgXCJzb2xpZC1qc1wiLFxuICAgICAgXCJzb2xpZC1qcy93ZWJcIixcbiAgICAgIFwiQG1vZGVsY29udGV4dHByb3RvY29sL3Nka1wiLFxuICAgICAgXCJAYWdlbnQtbmF0aXZlL2NvcmVcIixcbiAgICAgIFwiQG1lZHYvZmluZGVyXCIsXG4gICAgICBcImJpcHB5XCIsXG4gICAgICBcImVsZW1lbnQtc291cmNlXCIsXG4gICAgICBcInpvZFwiLFxuICAgIF0sXG4gIH0sXG5dKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBOE8sU0FBUyxvQkFBb0I7QUFDM1EsU0FBUyxtQkFBbUI7QUFFNUIsSUFBTyxzQkFBUSxhQUFhO0FBQUE7QUFBQSxFQUUxQjtBQUFBLElBQ0UsT0FBTztBQUFBLE1BQ0wsaUJBQWlCO0FBQUEsTUFDakIsT0FBTztBQUFBLElBQ1Q7QUFBQSxJQUNBLFFBQVEsQ0FBQyxLQUFLO0FBQUEsSUFDZCxLQUFLO0FBQUEsSUFDTCxXQUFXO0FBQUEsSUFDWCxPQUFPO0FBQUEsSUFDUCxVQUFVLENBQUMsU0FBUyxhQUFhLFdBQVcsMkJBQTJCO0FBQUEsSUFDdkUsWUFBWSxDQUFDLFVBQVU7QUFBQSxJQUN2QixnQkFBZ0IsQ0FBQyxZQUFZLEVBQUUsT0FBTyxFQUFFLFVBQVUsTUFBTSxFQUFFLENBQUMsQ0FBQztBQUFBLElBQzVELGVBQWUsU0FBUztBQUN0QixjQUFRLGFBQWEsQ0FBQyxXQUFXLFNBQVMsVUFBVSxRQUFRO0FBQUEsSUFDOUQ7QUFBQSxJQUNBLFFBQVEsRUFBRSxJQUFJLGdCQUFnQjtBQUFBLEVBQ2hDO0FBQUE7QUFBQSxFQUVBO0FBQUEsSUFDRSxPQUFPO0FBQUEsTUFDTCxPQUFPO0FBQUEsTUFDUCxnQkFBZ0I7QUFBQSxNQUNoQixvQkFBb0I7QUFBQSxNQUNwQixlQUFlO0FBQUEsTUFDZixLQUFLO0FBQUEsSUFDUDtBQUFBLElBQ0EsUUFBUSxDQUFDLEtBQUs7QUFBQSxJQUNkLEtBQUs7QUFBQSxJQUNMLFdBQVc7QUFBQSxJQUNYLFVBQVU7QUFBQSxNQUNSO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
