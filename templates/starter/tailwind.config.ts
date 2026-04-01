import type { Config } from "tailwindcss";
import preset, { coreContentGlob } from "@agent-native/core/tailwind";

export default {
  presets: [preset],
  content: ["./app/**/*.{ts,tsx}", coreContentGlob],
} satisfies Config;
