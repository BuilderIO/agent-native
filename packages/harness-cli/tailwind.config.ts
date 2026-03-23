import type { Config } from "tailwindcss";
import preset from "@agent-native/core/tailwind";

export default {
  darkMode: ["class"],
  presets: [preset],
  content: [
    "./client/**/*.{ts,tsx}",
    "./index.html",
    "../core/src/client/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        panel: "#111",
        "panel-border": "#222",
        "panel-header": "#0d0d0d",
      },
    },
  },
} satisfies Config;
