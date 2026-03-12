import type { Config } from "tailwindcss";
import preset from "agentnative/tailwind";

export default {
  presets: [preset],
  content: ["./client/**/*.{ts,tsx}"],
} satisfies Config;
