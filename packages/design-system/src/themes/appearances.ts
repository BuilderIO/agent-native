/**
 * The color tints a person can pick (`data-appearance` on the root, set by
 * core's change-appearance action), as overrides of a theme's own values.
 * The Agent-Native theme ignores them.
 */
export const APPEARANCES = {
  warm: {
    light: {
      background: "35 30% 97%",
      "sidebar-background": "35 28% 95%",
      accent: "30 35% 92%",
      muted: "35 25% 94%",
      primary: "25 65% 45%",
      ring: "25 55% 50%",
    },
    dark: {
      background: "28 14% 7%",
      "sidebar-background": "28 14% 5%",
      accent: "28 12% 14%",
      muted: "28 10% 12%",
      primary: "30 65% 65%",
      ring: "30 55% 55%",
    },
  },
  ocean: {
    light: {
      background: "210 35% 97%",
      "sidebar-background": "210 32% 95%",
      accent: "200 40% 92%",
      muted: "210 28% 94%",
      primary: "205 70% 42%",
      ring: "205 60% 50%",
    },
    dark: {
      background: "215 25% 8%",
      "sidebar-background": "215 28% 6%",
      accent: "215 22% 15%",
      muted: "215 20% 12%",
      primary: "200 75% 65%",
      ring: "200 65% 55%",
    },
  },
  forest: {
    light: {
      background: "130 22% 97%",
      "sidebar-background": "130 20% 95%",
      accent: "135 28% 92%",
      muted: "130 18% 94%",
      primary: "145 55% 35%",
      ring: "145 45% 45%",
    },
    dark: {
      background: "140 14% 7%",
      "sidebar-background": "140 14% 5%",
      accent: "140 12% 14%",
      muted: "140 10% 12%",
      primary: "145 50% 60%",
      ring: "145 40% 50%",
    },
  },
  rose: {
    light: {
      background: "340 35% 98%",
      "sidebar-background": "340 32% 96%",
      accent: "345 40% 93%",
      muted: "340 28% 95%",
      primary: "345 60% 50%",
      ring: "345 50% 55%",
    },
    dark: {
      background: "340 14% 8%",
      "sidebar-background": "340 14% 6%",
      accent: "340 14% 15%",
      muted: "340 12% 12%",
      primary: "345 65% 65%",
      ring: "345 55% 55%",
    },
  },
  slate: {
    light: {
      background: "215 16% 96%",
      "sidebar-background": "215 14% 94%",
      accent: "215 18% 91%",
      muted: "215 14% 93%",
      primary: "215 25% 25%",
      ring: "215 20% 40%",
    },
    dark: {
      background: "215 14% 8%",
      "sidebar-background": "215 14% 6%",
      accent: "215 12% 14%",
      muted: "215 10% 12%",
      primary: "215 15% 75%",
      ring: "215 12% 60%",
    },
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      light: Readonly<Record<string, string>>;
      dark: Readonly<Record<string, string>>;
    }
  >
>;
