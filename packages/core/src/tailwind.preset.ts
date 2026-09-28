/**
 * @deprecated Legacy Tailwind v3 preset.
 *
 * The framework has moved to Tailwind v4. Templates should now use the shared
 * stylesheet from CSS instead of a `tailwind.config.ts`:
 *
 *   // app/global.css
 *   @import "tailwindcss";
 *   @import "@agent-native/core/styles/agent-native.css";
 *
 * No `tailwind.config.ts` or `postcss.config.js` is needed. The
 * `@tailwindcss/vite` plugin is auto-injected by `defineConfig()`.
 *
 * This export is kept only for third-party templates still on the v3 PostCSS pipeline.
 */
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import type { Config } from "tailwindcss";

const thisDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

export const coreContentGlob = join(thisDir, "client", "**/*.{js,mjs}");

const preset = {
  darkMode: ["class"],
  content: [coreContentGlob],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [
    (() => {
      try {
        return require("tailwindcss-animate");
      } catch {
        return null;
      }
    })(),
    (() => {
      try {
        return require("@tailwindcss/typography");
      } catch {
        return null;
      }
    })(),
  ].filter(Boolean),
};

export default preset as unknown as Config;
