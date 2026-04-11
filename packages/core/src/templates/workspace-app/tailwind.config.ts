import type { Config } from "tailwindcss";
// Import from the workspace core module instead of @agent-native/core so
// enterprise brand tokens propagate to every app in the workspace. The
// workspace core's preset already chains through the framework defaults.
import preset from "@{{WORKSPACE_NAME}}/core-module/tailwind";

export default {
  presets: [preset],
  content: [
    "./app/**/*.{ts,tsx}",
    // Also scan the workspace core's client components so any shared
    // classes (AuthenticatedLayout, etc.) are included in the bundle.
    "../../packages/core-module/src/client/**/*.{ts,tsx}",
  ],
} satisfies Config;
