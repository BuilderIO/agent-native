import type { Config } from "tailwindcss";

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

// Scan @agent-native/core's dist/client for Tailwind classes used in
// core components (AgentPanel, AssistantChat, etc.)
const thisDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

/**
 * Glob pattern that matches all core client component files.
 * Templates MUST include this in their `content` array — Tailwind v3
 * does NOT merge `content` from presets, so the preset alone isn't enough.
 *
 * Usage:
 *   import preset, { coreContentGlob } from "@agent-native/core/tailwind";
 *   export default { presets: [preset], content: ["./app/**\/*.{ts,tsx}", coreContentGlob] };
 */
export const coreContentGlob = join(thisDir, "client", "**/*.{js,mjs}");

// Cast to `any` for the inner config — Tailwind v4 ships stricter Config types
// than v3 (e.g. `darkMode: ["class"]` is v3-only). This file exists only to
// keep third-party v3 setups working until they migrate.
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
    // tailwindcss-animate is v3-only and is no longer a peer dep — guard the require.
    (() => {
      try {
        return require("tailwindcss-animate");
      } catch {
        return null;
      }
    })(),
    require("@tailwindcss/typography"),
  ].filter(Boolean),
};

export default preset as unknown as Config;
