import type { Config } from "tailwindcss";
import preset from "@agent-native/core/tailwind";

export default {
  presets: [preset],
  content: ["./app/**/*.{ts,tsx}"],
} satisfies Config;
