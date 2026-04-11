/**
 * Workspace-wide Tailwind preset for @{{APP_NAME}}/core-module.
 *
 * Extends the framework's base preset with enterprise brand tokens. Every
 * app in the workspace should import THIS preset in its own
 * tailwind.config.ts instead of importing @agent-native/core/tailwind
 * directly, so brand updates in one place propagate to all apps.
 *
 *   // apps/<name>/tailwind.config.ts
 *   import preset from "@{{APP_NAME}}/core-module/tailwind";
 *   export default { presets: [preset], content: ["./app/**\/*.{ts,tsx}"] };
 *
 * If your enterprise already has a design-system package with its own
 * Tailwind preset, swap `corePreset` out for that one (or chain both).
 */
import corePreset from "@agent-native/core/tailwind";
import type { Config } from "tailwindcss";

const preset: Partial<Config> = {
  presets: [corePreset],
  theme: {
    extend: {
      colors: {
        // Replace with your actual brand palette.
        brand: {
          DEFAULT: "#4f46e5",
          foreground: "#ffffff",
        },
      },
    },
  },
};

export default preset;
