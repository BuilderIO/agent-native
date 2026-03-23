import type { Config } from "tailwindcss";

export default {
  content: ["./client/**/*.{ts,tsx}", "./index.html"],
  theme: {
    extend: {
      colors: {
        panel: "#111",
        "panel-border": "#222",
        "panel-header": "#0d0d0d",
        muted: "#666",
        "muted-foreground": "#999",
      },
    },
  },
  plugins: [],
} satisfies Config;
