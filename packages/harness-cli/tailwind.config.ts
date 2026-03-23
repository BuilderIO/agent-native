import type { Config } from "tailwindcss";

export default {
  content: ["./client/**/*.{ts,tsx}", "./index.html"],
  theme: {
    extend: {
      colors: {
        panel: "#141519",
        "panel-border": "#1e2028",
        "panel-header": "#0e0f14",
        muted: "#666",
        "muted-foreground": "#999",
      },
    },
  },
  plugins: [],
} satisfies Config;
